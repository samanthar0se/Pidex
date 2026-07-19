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
import { basename, join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";
import {
  publishValidatedTree,
  replaceRebuildableFile,
  writeCandidate,
} from "../../durability/src/index.js";

export interface HostCertificate { key: Buffer; cert: Buffer; ca: Buffer }

interface TlsIdentity {
  schemaVersion: 1;
  generationId: string;
  hostname: string;
  digests: Record<MaterialName, string>;
}

type MaterialName = "pidex-ca.pem" | "pidex-ca-key.dpapi" | "host.pem" | "host-key.dpapi";
const MATERIALS: MaterialName[] = ["pidex-ca.pem", "pidex-ca-key.dpapi", "host.pem", "host-key.dpapi"];

/** Selects only a complete, cryptographically coherent retained TLS generation. */
export function ensureCertificate(dataDir: string, hostname: string, windows: WindowsPlatformAdapter): HostCertificate {
  const tlsRoot = join(dataDir, "tls");
  const generations = join(tlsRoot, "generations");
  mkdirSync(generations, { recursive: true });
  windows.restrictToCurrentUser(tlsRoot);

  let generation = selectGeneration(generations, hostname, windows);
  if (!generation) {
    generation = publishGeneration(tlsRoot, generations, hostname, windows);
  }

  // The selector is a rebuildable hint. Validation never relies on it.
  replaceRebuildableFile({
    target: join(tlsRoot, "Generation"),
    materialize: writeCandidate(`${generation}\n`),
    validate: path => readFileSync(path, "utf8").trim() === generation,
  });

  const selected = join(generations, generation);
  validateGeneration(selected, hostname, windows);
  windows.trustCurrentUserCertificate(join(selected, "pidex-ca.pem"));
  return {
    key: windows.unprotectForCurrentUser(readFileSync(join(selected, "host-key.dpapi"))),
    cert: readFileSync(join(selected, "host.pem")),
    ca: readFileSync(join(selected, "pidex-ca.pem")),
  };
}

function selectGeneration(root: string, hostname: string, windows: WindowsPlatformAdapter): string | undefined {
  const retained = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  const valid = retained.filter(name => {
      try { validateGeneration(join(root, name), hostname, windows); return true; }
      catch { return false; }
    });
  if (retained.length > 0 && valid.length === 0) throw new Error("TLS generation validation failed");
  if (valid.length > 1) throw new Error("TLS generations are ambiguous");
  return valid[0];
}

function publishGeneration(tlsRoot: string, generations: string, hostname: string, windows: WindowsPlatformAdapter): string {
  const generationId = randomUUID();
  // OpenSSL scratch is deliberately outside the validated publication stage.
  const scratchRoot = join(tlsRoot, ".scratch");
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, "openssl-"));
  try {
    generateMaterial(scratch, hostname);
    const protectedMaterial = new Map<MaterialName, Buffer>([
      ["pidex-ca.pem", readFileSync(join(scratch, "pidex-ca.pem"))],
      ["pidex-ca-key.dpapi", windows.protectForCurrentUser(readFileSync(join(scratch, "ca-key.pem")))],
      ["host.pem", readFileSync(join(scratch, "host.pem"))],
      ["host-key.dpapi", windows.protectForCurrentUser(readFileSync(join(scratch, "host-key.pem")))],
    ]);
    const identity: TlsIdentity = {
      schemaVersion: 1, generationId, hostname,
      digests: Object.fromEntries(MATERIALS.map(name => [name, digest(protectedMaterial.get(name)!)])) as Record<MaterialName, string>,
    };
    publishValidatedTree({
      target: join(generations, generationId),
      materialize(stage) {
        for (const [name, bytes] of protectedMaterial) writeFileSync(join(stage, name), bytes, { flag: "wx" });
        writeFileSync(join(stage, "identity.json"), JSON.stringify(identity, null, 2), { flag: "wx" });
      },
      validate: path => { validateGeneration(path, hostname, windows); },
    });
    return generationId;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    try { if (readdirSync(scratchRoot).length === 0) rmSync(scratchRoot, { recursive: true }); } catch {}
  }
}

function validateGeneration(directory: string, hostname: string, windows: WindowsPlatformAdapter): void {
  const names = readdirSync(directory).sort();
  const expected = [...MATERIALS, "identity.json"].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("TLS generation is incomplete");
  const identity = JSON.parse(readFileSync(join(directory, "identity.json"), "utf8")) as Partial<TlsIdentity>;
  const directoryName = basename(directory);
  const identityMatchesDirectory = typeof identity.generationId === "string" &&
    (directoryName === identity.generationId || directoryName.startsWith(`.${identity.generationId}.`));
  if (identity.schemaVersion !== 1 || identity.hostname !== hostname || !identityMatchesDirectory || !identity.digests) {
    throw new Error("TLS identity metadata is invalid");
  }
  for (const name of MATERIALS) {
    if (identity.digests[name] !== digest(readFileSync(join(directory, name)))) throw new Error("TLS generation material is mixed");
  }
  const ca = new X509Certificate(readFileSync(join(directory, "pidex-ca.pem")));
  const leaf = new X509Certificate(readFileSync(join(directory, "host.pem")));
  const caKey = createPrivateKey(windows.unprotectForCurrentUser(readFileSync(join(directory, "pidex-ca-key.dpapi"))));
  const leafKey = createPrivateKey(windows.unprotectForCurrentUser(readFileSync(join(directory, "host-key.dpapi"))));
  if (!ca.checkPrivateKey(caKey) || !leaf.checkPrivateKey(leafKey) || !leaf.checkIssued(ca) || leaf.checkHost(hostname) !== hostname) {
    throw new Error("TLS generation is not cryptographically coherent");
  }
}

function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

function generateMaterial(directory: string, hostname: string): void {
  const caKey = join(directory, "ca-key.pem");
  const leafKey = join(directory, "host-key.pem");
  const csr = join(directory, "leaf.csr");
  const ext = join(directory, "leaf.ext");
  runOpenSsl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", join(directory, "pidex-ca.pem"), "-days", "3650", "-subj", "/CN=Pidex Private CA"]);
  runOpenSsl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", leafKey, "-out", csr, "-subj", `/CN=${hostname}`]);
  writeFileSync(ext, `subjectAltName=DNS:${hostname},DNS:localhost,IP:127.0.0.1\n`);
  runOpenSsl(["x509", "-req", "-in", csr, "-CA", join(directory, "pidex-ca.pem"), "-CAkey", caKey, "-CAcreateserial", "-out", join(directory, "host.pem"), "-days", "825", "-extfile", ext]);
}
function runOpenSsl(args: string[]): void { execFileSync("openssl", args, { stdio: "ignore" }); }
