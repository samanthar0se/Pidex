import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

export const DEVELOPMENT_CA_REMEDIATION =
  "Development CA unusable. Startup did not replace it; run `npm run dev-ca:reset`, then `npm run dev-ca:setup`.";

const DEVELOPMENT_CA_CERTIFICATE_NAME = "development-ca.pem";
const DEVELOPMENT_CA_KEY_NAME = "development-ca-key.pem";
const DEVELOPMENT_LEAF_CERTIFICATE_NAME = "development-leaf.pem";
const DEVELOPMENT_LEAF_KEY_NAME = "development-leaf-key.pem";
const DEVELOPMENT_CA_RESET_WARNING =
  "Development CA reset affects every checkout and previously trusted LAN client. Run setup next; distribute only the public certificate.";
const SERVER_AUTHENTICATION_KEY_USAGE = "1.3.6.1.5.5.7.3.1";
const MILLISECONDS_PER_DAY = 86_400_000;

export interface DevelopmentCaResult {
  status: "created" | "unchanged";
  fingerprint: string;
  certificatePath: string;
}

export interface DevelopmentCertificate {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
  fingerprint: string;
  replaced: boolean;
}

interface DevelopmentCaPaths {
  certificate: string;
  key: string;
}

interface DevelopmentLeafPaths {
  certificate: string;
  key: string;
  certificateRequest: string;
  extensions: string;
  serial: string;
}

interface SubjectAlternativeName {
  type: "DNS" | "IP";
  value: string;
}

type TrustAdapter = Pick<
  WindowsPlatformAdapter,
  "trustCurrentUserCertificate" | "removeCurrentUserCertificate"
>;

export function defaultDevelopmentCaDirectory(
  environment = process.env,
): string {
  const localAppData = environment.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error(
      "LOCALAPPDATA is required for the Windows Development CA profile location",
    );
  }
  return join(localAppData, "Pidex", "development-ca");
}

export function setupDevelopmentCa(
  profileDirectory: string,
  windows: TrustAdapter,
): DevelopmentCaResult {
  mkdirSync(profileDirectory, { recursive: true });
  const paths = developmentCaPaths(profileDirectory);
  const certificateExists = existsSync(paths.certificate);
  const keyExists = existsSync(paths.key);
  let status: DevelopmentCaResult["status"] = "unchanged";

  if (!certificateExists && !keyExists) {
    requireOpenSsl();
    generateDevelopmentCa(paths);
    status = "created";
  } else if (!certificateExists || !keyExists) {
    throw developmentCaUnusableError();
  }

  const certificate = validateDevelopmentCa(paths);
  windows.trustCurrentUserCertificate(paths.certificate);
  return {
    status,
    fingerprint: certificateFingerprint(certificate),
    certificatePath: paths.certificate,
  };
}

export function ensureDevelopmentCertificate(
  profileDirectory: string,
  checkoutDataDirectory: string,
  requestedNames: readonly string[],
  now = new Date(),
): DevelopmentCertificate {
  const caPaths = developmentCaPaths(profileDirectory);
  let caCertificate: X509Certificate;
  try {
    caCertificate = validateDevelopmentCa(caPaths, now);
  } catch {
    throw developmentCaUnusableError();
  }

  const tlsDirectory = join(checkoutDataDirectory, "tls");
  mkdirSync(tlsDirectory, { recursive: true });
  const leafPaths = developmentLeafPaths(tlsDirectory);
  const subjectAlternativeNames = normalizeSubjectAlternativeNames(
    requestedNames,
  );

  if (
    isDevelopmentLeafReusable(
      leafPaths.certificate,
      leafPaths.key,
      caCertificate,
      subjectAlternativeNames,
      now,
    )
  ) {
    return readDevelopmentCertificate(leafPaths, caCertificate, false);
  }

  requireOpenSsl();
  generateDevelopmentLeaf(
    caPaths,
    leafPaths,
    subjectAlternativeNames,
  );

  const issuanceValidationTime = new Date(
    Math.max(now.getTime(), Date.now()),
  );
  if (
    !isDevelopmentLeafReusable(
      leafPaths.certificate,
      leafPaths.key,
      caCertificate,
      subjectAlternativeNames,
      issuanceValidationTime,
      0,
    )
  ) {
    throw new Error("Generated Development leaf failed validation");
  }

  return readDevelopmentCertificate(leafPaths, caCertificate, true);
}

export function resetDevelopmentCa(
  profileDirectory: string,
  windows: TrustAdapter,
): {
  warning: string;
  cleanup: "complete" | "best-effort";
} {
  const paths = developmentCaPaths(profileDirectory);
  let cleanup: "complete" | "best-effort" = "complete";

  if (existsSync(paths.certificate)) {
    try {
      windows.removeCurrentUserCertificate?.(paths.certificate);
    } catch {
      cleanup = "best-effort";
    }
  }

  rmSync(paths.certificate, { force: true });
  rmSync(paths.key, { force: true });
  return { warning: DEVELOPMENT_CA_RESET_WARNING, cleanup };
}

function developmentCaPaths(directory: string): DevelopmentCaPaths {
  return {
    certificate: join(directory, DEVELOPMENT_CA_CERTIFICATE_NAME),
    key: join(directory, DEVELOPMENT_CA_KEY_NAME),
  };
}

function developmentLeafPaths(directory: string): DevelopmentLeafPaths {
  return {
    certificate: join(directory, DEVELOPMENT_LEAF_CERTIFICATE_NAME),
    key: join(directory, DEVELOPMENT_LEAF_KEY_NAME),
    certificateRequest: join(directory, ".leaf.csr"),
    extensions: join(directory, ".leaf.ext"),
    serial: join(directory, ".ca.srl"),
  };
}

function generateDevelopmentCa(paths: DevelopmentCaPaths): void {
  runOpenSsl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "3650",
    "-keyout",
    paths.key,
    "-out",
    paths.certificate,
    "-subj",
    "/CN=Pidex Development CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE,pathlen:0",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
}

function generateDevelopmentLeaf(
  caPaths: DevelopmentCaPaths,
  leafPaths: DevelopmentLeafPaths,
  subjectAlternativeNames: readonly SubjectAlternativeName[],
): void {
  const commonName = subjectAlternativeNames.at(0);
  if (!commonName) {
    throw new Error("At least one Development certificate name is required");
  }

  try {
    runOpenSsl([
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      leafPaths.key,
      "-out",
      leafPaths.certificateRequest,
      "-subj",
      `/CN=${commonName.value}`,
    ]);
    writeFileSync(
      leafPaths.extensions,
      [
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
        `subjectAltName=${subjectAlternativeNames
          .map(name => `${name.type}:${name.value}`)
          .join(",")}`,
      ].join("\n"),
    );
    runOpenSsl([
      "x509",
      "-req",
      "-in",
      leafPaths.certificateRequest,
      "-CA",
      caPaths.certificate,
      "-CAkey",
      caPaths.key,
      "-CAcreateserial",
      "-CAserial",
      leafPaths.serial,
      "-out",
      leafPaths.certificate,
      "-days",
      "825",
      "-sha256",
      "-extfile",
      leafPaths.extensions,
    ]);
  } finally {
    for (const path of [
      leafPaths.certificateRequest,
      leafPaths.extensions,
      leafPaths.serial,
    ]) {
      rmSync(path, { force: true });
    }
  }
}

function validateDevelopmentCa(
  paths: DevelopmentCaPaths,
  now = new Date(),
): X509Certificate {
  if (!existsSync(paths.certificate) || !existsSync(paths.key)) {
    throw developmentCaUnusableError();
  }

  const certificate = new X509Certificate(readFileSync(paths.certificate));
  const privateKey = readFileSync(paths.key);
  createPrivateKey(privateKey);

  if (
    !certificate.ca ||
    !certificate.checkIssued(certificate) ||
    !certificate.verify(certificate.publicKey)
  ) {
    throw developmentCaUnusableError();
  }

  const privateKeyPublicBytes = createPublicKey(privateKey).export({
    type: "spki",
    format: "der",
  });
  const certificatePublicBytes = certificate.publicKey.export({
    type: "spki",
    format: "der",
  });
  if (
    privateKeyPublicBytes.compare(certificatePublicBytes) !== 0 ||
    now < new Date(certificate.validFrom) ||
    now >= new Date(certificate.validTo)
  ) {
    throw developmentCaUnusableError();
  }

  const certificateText = readOpenSslOutput([
    "x509",
    "-in",
    paths.certificate,
    "-noout",
    "-text",
  ]);
  const hasRequiredBasicConstraints =
    /Basic Constraints: critical[\s\S]*CA:TRUE, pathlen:0/.test(
      certificateText,
    );
  const hasRequiredKeyUsage =
    /Key Usage: critical[\s\S]*Certificate Sign/.test(certificateText);
  if (!hasRequiredBasicConstraints || !hasRequiredKeyUsage) {
    throw developmentCaUnusableError();
  }

  return certificate;
}

function normalizeSubjectAlternativeNames(
  values: readonly string[],
): SubjectAlternativeName[] {
  const names = [...values, "localhost", "127.0.0.1"];
  const uniqueNames = new Map<string, SubjectAlternativeName>();

  for (const value of names) {
    const name: SubjectAlternativeName = {
      type: isIP(value) ? "IP" : "DNS",
      value,
    };
    uniqueNames.set(`${name.type}:${value.toLowerCase()}`, name);
  }

  return [...uniqueNames.values()].sort((left, right) =>
    `${left.type}:${left.value}`.localeCompare(`${right.type}:${right.value}`),
  );
}

function isDevelopmentLeafReusable(
  certificatePath: string,
  keyPath: string,
  caCertificate: X509Certificate,
  subjectAlternativeNames: readonly SubjectAlternativeName[],
  now: Date,
  validityMarginDays = 30,
): boolean {
  try {
    if (!existsSync(certificatePath) || !existsSync(keyPath)) {
      return false;
    }

    const certificate = new X509Certificate(readFileSync(certificatePath));
    const privateKey = readFileSync(keyPath);
    createPrivateKey(privateKey);

    const actualSubjectAlternativeNames = (
      certificate.subjectAltName?.split(", ") ?? []
    )
      .map(value => value.replace("IP Address:", "IP:"))
      .sort();
    const expectedSubjectAlternativeNames = subjectAlternativeNames
      .map(name => `${name.type}:${name.value}`)
      .sort();
    const privateKeyPublicBytes = createPublicKey(privateKey).export({
      type: "spki",
      format: "der",
    });
    const certificatePublicBytes = certificate.publicKey.export({
      type: "spki",
      format: "der",
    });
    const validBeyondMargin =
      now.getTime() + validityMarginDays * MILLISECONDS_PER_DAY <
      new Date(certificate.validTo).getTime();
    const hasServerAuthenticationUsage =
      certificate.keyUsage === undefined ||
      certificate.keyUsage.includes(SERVER_AUTHENTICATION_KEY_USAGE);

    return (
      !certificate.ca &&
      certificate.checkIssued(caCertificate) &&
      certificate.verify(caCertificate.publicKey) &&
      privateKeyPublicBytes.compare(certificatePublicBytes) === 0 &&
      now >= new Date(certificate.validFrom) &&
      validBeyondMargin &&
      JSON.stringify(actualSubjectAlternativeNames) ===
        JSON.stringify(expectedSubjectAlternativeNames) &&
      hasServerAuthenticationUsage
    );
  } catch {
    return false;
  }
}

function readDevelopmentCertificate(
  paths: DevelopmentLeafPaths,
  caCertificate: X509Certificate,
  replaced: boolean,
): DevelopmentCertificate {
  return {
    key: readFileSync(paths.key),
    cert: readFileSync(paths.certificate),
    ca: caCertificate.raw,
    fingerprint: certificateFingerprint(caCertificate),
    replaced,
  };
}

function certificateFingerprint(certificate: X509Certificate): string {
  const digest = createHash("sha256")
    .update(certificate.raw)
    .digest("hex")
    .toUpperCase();
  return digest.replace(/(..)(?=.)/g, "$1:");
}

function requireOpenSsl(): void {
  try {
    readOpenSslOutput(["version"]);
  } catch {
    throw new Error(
      "OpenSSL is required for Development CA setup and leaf issuance",
    );
  }
}

function runOpenSsl(opensslArguments: string[]): void {
  execFileSync("openssl", opensslArguments, { stdio: "ignore" });
}

function readOpenSslOutput(opensslArguments: string[]): string {
  return (
    execFileSync("openssl", opensslArguments, {
      encoding: "utf8",
      stdio: "pipe",
    }) ?? ""
  );
}

function developmentCaUnusableError(): Error {
  return new Error(DEVELOPMENT_CA_REMEDIATION);
}
