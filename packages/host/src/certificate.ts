import { execFileSync } from "node:child_process";
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  randomUUID,
} from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { basename, join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";
import {
  publishValidatedTree,
  replaceRebuildableFile,
  writeCandidate,
} from "../../durability/src/index.js";

export interface HostCertificate {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
}

const TLS_MATERIAL_NAMES = [
  "pidex-ca.pem",
  "pidex-ca-key.dpapi",
  "host.pem",
  "host-key.dpapi",
] as const;

type TlsMaterialName = (typeof TLS_MATERIAL_NAMES)[number];
type TlsMaterial<T> = Record<TlsMaterialName, T>;

interface TlsIdentity {
  schemaVersion: 1;
  generationId: string;
  hostname: string;
  digests: TlsMaterial<string>;
}

export interface HostCertificateProvisioningRequest {
  dataDir: string;
  hostname: string;
  windows: WindowsPlatformAdapter;
}

/** Supplies TLS certificate material during Host startup. */
export type HostCertificateProvisioner = (
  request: HostCertificateProvisioningRequest,
) => HostCertificate | Promise<HostCertificate>;

/** Provisions the durable, protected certificate used by the packaged Host. */
export function provisionPackagedHostCertificate(
  request: HostCertificateProvisioningRequest,
): HostCertificate {
  return ensureCertificate(request.dataDir, request.hostname, request.windows);
}

/** Selects only a complete, cryptographically coherent retained TLS generation. */
export function ensureCertificate(
  dataDir: string,
  hostname: string,
  windows: WindowsPlatformAdapter,
): HostCertificate {
  const tlsRoot = join(dataDir, "tls");
  const generationsDirectory = join(tlsRoot, "generations");
  mkdirSync(generationsDirectory, { recursive: true });
  windows.restrictToCurrentUser(tlsRoot);

  let generationId = selectGeneration(
    generationsDirectory,
    hostname,
    windows,
  );
  if (!generationId) {
    generationId = publishGeneration(
      tlsRoot,
      generationsDirectory,
      hostname,
      windows,
    );
  }

  // The selector is a rebuildable hint. Validation never relies on it.
  replaceRebuildableFile({
    target: join(tlsRoot, "Generation"),
    materialize: writeCandidate(`${generationId}\n`),
    validate: path => readFileSync(path, "utf8").trim() === generationId,
  });

  const selectedGeneration = join(generationsDirectory, generationId);
  validateGeneration(selectedGeneration, hostname, windows);
  windows.trustCurrentUserCertificate(
    join(selectedGeneration, "pidex-ca.pem"),
  );
  return {
    key: windows.unprotectForCurrentUser(
      readFileSync(join(selectedGeneration, "host-key.dpapi")),
    ),
    cert: readFileSync(join(selectedGeneration, "host.pem")),
    ca: readFileSync(join(selectedGeneration, "pidex-ca.pem")),
  };
}

/** Validates retained TLS generations without creating or selecting one. */
export function validateRetainedCertificateIdentity(
  dataDir: string,
  windows: WindowsPlatformAdapter,
): void {
  const generationsDirectory = join(dataDir, "tls", "generations");
  const generation = readdirSync(generationsDirectory, {
    withFileTypes: true,
  }).find(entry => entry.isDirectory());
  if (!generation) {
    throw new Error("TLS identity is incomplete");
  }

  const identity = JSON.parse(
    readFileSync(
      join(generationsDirectory, generation.name, "identity.json"),
      "utf8",
    ),
  ) as Partial<TlsIdentity>;
  if (typeof identity.hostname !== "string") {
    throw new Error("TLS identity hostname is missing");
  }

  // Discovery validates every retained generation and rejects ambiguous
  // installation identities. The selector remains only a rebuildable hint.
  if (!selectGeneration(generationsDirectory, identity.hostname, windows)) {
    throw new Error("TLS identity is incomplete");
  }
}

function selectGeneration(
  generationsDirectory: string,
  hostname: string,
  windows: WindowsPlatformAdapter,
): string | undefined {
  const retainedGenerationIds = readdirSync(generationsDirectory, {
    withFileTypes: true,
  })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  const retainedGenerations = retainedGenerationIds.map(generationId => {
    const directory = join(generationsDirectory, generationId);
    try {
      const identity = JSON.parse(
        readFileSync(join(directory, "identity.json"), "utf8"),
      ) as Partial<TlsIdentity>;
      if (typeof identity.hostname !== "string") {
        throw new Error("TLS identity hostname is missing");
      }
      validateGeneration(directory, identity.hostname, windows);
      return {
        generationId,
        hostname: identity.hostname,
        certificateAuthorityDigest: digest(
          readFileSync(join(directory, "pidex-ca.pem")),
        ),
      };
    } catch (error) {
      throw new Error("TLS generation validation failed", { cause: error });
    }
  });
  if (
    new Set(
      retainedGenerations.map(item => item.certificateAuthorityDigest),
    ).size > 1
  ) {
    throw new Error("TLS generations have ambiguous installation identities");
  }

  const matchingGenerationIds = retainedGenerations
    .filter(item => item.hostname === hostname)
    .map(item => item.generationId);
  if (matchingGenerationIds.length > 1) {
    throw new Error("TLS generations are ambiguous");
  }
  return matchingGenerationIds[0];
}

function publishGeneration(
  tlsRoot: string,
  generationsDirectory: string,
  hostname: string,
  windows: WindowsPlatformAdapter,
): string {
  const generationId = randomUUID();
  // OpenSSL scratch is deliberately outside the validated publication stage.
  const scratchRoot = join(tlsRoot, ".scratch");
  mkdirSync(scratchRoot, { recursive: true });
  const scratchDirectory = mkdtempSync(join(scratchRoot, "openssl-"));
  try {
    generateMaterial(
      scratchDirectory,
      hostname,
      reusableCertificateAuthority(generationsDirectory, windows),
    );
    const protectedMaterial = readProtectedMaterial(
      scratchDirectory,
      windows,
    );
    const identity: TlsIdentity = {
      schemaVersion: 1,
      generationId,
      hostname,
      digests: materialDigests(protectedMaterial),
    };

    publishValidatedTree({
      target: join(generationsDirectory, generationId),
      materialize(stage) {
        for (const name of TLS_MATERIAL_NAMES) {
          writeFileSync(join(stage, name), protectedMaterial[name], {
            flag: "wx",
          });
        }
        writeFileSync(
          join(stage, "identity.json"),
          JSON.stringify(identity, null, 2),
          { flag: "wx" },
        );
      },
      validate: path => {
        validateGeneration(path, hostname, windows);
      },
    });
    return generationId;
  } finally {
    rmSync(scratchDirectory, { recursive: true, force: true });
    removeEmptyDirectory(scratchRoot);
  }
}

function reusableCertificateAuthority(
  generationsDirectory: string,
  windows: WindowsPlatformAdapter,
): { certificate: Buffer; privateKey: Buffer } | undefined {
  const generation = readdirSync(generationsDirectory, {
    withFileTypes: true,
  }).find(entry => entry.isDirectory());
  if (!generation) {
    return undefined;
  }

  const directory = join(generationsDirectory, generation.name);
  return {
    certificate: readFileSync(join(directory, "pidex-ca.pem")),
    privateKey: windows.unprotectForCurrentUser(
      readFileSync(join(directory, "pidex-ca-key.dpapi")),
    ),
  };
}

function readProtectedMaterial(
  scratchDirectory: string,
  windows: WindowsPlatformAdapter,
): TlsMaterial<Buffer> {
  return {
    "pidex-ca.pem": readFileSync(join(scratchDirectory, "pidex-ca.pem")),
    "pidex-ca-key.dpapi": windows.protectForCurrentUser(
      readFileSync(join(scratchDirectory, "ca-key.pem")),
    ),
    "host.pem": readFileSync(join(scratchDirectory, "host.pem")),
    "host-key.dpapi": windows.protectForCurrentUser(
      readFileSync(join(scratchDirectory, "host-key.pem")),
    ),
  };
}

function materialDigests(material: TlsMaterial<Buffer>): TlsMaterial<string> {
  return {
    "pidex-ca.pem": digest(material["pidex-ca.pem"]),
    "pidex-ca-key.dpapi": digest(material["pidex-ca-key.dpapi"]),
    "host.pem": digest(material["host.pem"]),
    "host-key.dpapi": digest(material["host-key.dpapi"]),
  };
}

function removeEmptyDirectory(directory: string): void {
  try {
    if (readdirSync(directory).length === 0) {
      rmSync(directory, { recursive: true });
    }
  } catch {
    // Scratch cleanup is best-effort after its contents have been removed.
  }
}

function validateGeneration(
  directory: string,
  hostname: string,
  windows: WindowsPlatformAdapter,
): void {
  const actualNames = readdirSync(directory).sort();
  const expectedNames = [...TLS_MATERIAL_NAMES, "identity.json"].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("TLS generation is incomplete");
  }

  const identity = JSON.parse(
    readFileSync(join(directory, "identity.json"), "utf8"),
  ) as Partial<TlsIdentity>;
  const generationDirectoryName = basename(directory);
  const identityMatchesDirectory =
    typeof identity.generationId === "string" &&
    (generationDirectoryName === identity.generationId ||
      generationDirectoryName.startsWith(`.${identity.generationId}.`));
  if (
    identity.schemaVersion !== 1 ||
    identity.hostname !== hostname ||
    !identityMatchesDirectory ||
    !identity.digests
  ) {
    throw new Error("TLS identity metadata is invalid");
  }

  for (const name of TLS_MATERIAL_NAMES) {
    const publishedDigest = digest(readFileSync(join(directory, name)));
    if (identity.digests[name] !== publishedDigest) {
      throw new Error("TLS generation material is mixed");
    }
  }

  const certificateAuthority = new X509Certificate(
    readFileSync(join(directory, "pidex-ca.pem")),
  );
  const hostCertificate = new X509Certificate(
    readFileSync(join(directory, "host.pem")),
  );
  const certificateAuthorityKey = createPrivateKey(
    windows.unprotectForCurrentUser(
      readFileSync(join(directory, "pidex-ca-key.dpapi")),
    ),
  );
  const hostKey = createPrivateKey(
    windows.unprotectForCurrentUser(
      readFileSync(join(directory, "host-key.dpapi")),
    ),
  );
  const isCryptographicallyCoherent =
    certificateAuthority.checkPrivateKey(certificateAuthorityKey) &&
    hostCertificate.checkPrivateKey(hostKey) &&
    hostCertificate.checkIssued(certificateAuthority) &&
    (isIP(hostname)
      ? hostCertificate.checkIP(hostname) === hostname
      : hostCertificate.checkHost(hostname) === hostname);
  if (!isCryptographicallyCoherent) {
    throw new Error("TLS generation is not cryptographically coherent");
  }
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function generateMaterial(
  directory: string,
  hostname: string,
  certificateAuthority?: { certificate: Buffer; privateKey: Buffer },
): void {
  const certificateAuthorityKey = join(directory, "ca-key.pem");
  const hostKey = join(directory, "host-key.pem");
  const certificateRequest = join(directory, "leaf.csr");
  const extensions = join(directory, "leaf.ext");

  if (certificateAuthority) {
    writeFileSync(certificateAuthorityKey, certificateAuthority.privateKey);
    writeFileSync(
      join(directory, "pidex-ca.pem"),
      certificateAuthority.certificate,
    );
  } else {
    runOpenSsl([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      certificateAuthorityKey,
      "-out",
      join(directory, "pidex-ca.pem"),
      "-days",
      "3650",
      "-subj",
      "/CN=Pidex Private CA",
    ]);
  }
  runOpenSsl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    hostKey,
    "-out",
    certificateRequest,
    "-subj",
    `/CN=${hostname}`,
  ]);
  writeFileSync(
    extensions,
    `subjectAltName=${isIP(hostname) ? "IP" : "DNS"}:${hostname},DNS:localhost,IP:127.0.0.1\n`,
  );
  runOpenSsl([
    "x509",
    "-req",
    "-in",
    certificateRequest,
    "-CA",
    join(directory, "pidex-ca.pem"),
    "-CAkey",
    certificateAuthorityKey,
    "-CAcreateserial",
    "-out",
    join(directory, "host.pem"),
    "-days",
    "825",
    "-extfile",
    extensions,
  ]);
}

function runOpenSsl(opensslArguments: string[]): void {
  execFileSync("openssl", opensslArguments, { stdio: "ignore" });
}
