import { execFileSync } from "node:child_process";
import { X509Certificate, createPrivateKey, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

const CA_DIRECTORY = "Development CA";
const CERTIFICATE_FILE = "pidex-development-ca.pem";
const KEY_FILE = "pidex-development-ca-key.pem";
const STATE_FILE = "state.json";
const STATE_VERSION = 1;
const TEN_YEARS_DAYS = 3650;
const RENEWAL_MARGIN_MS = 30 * 24 * 60 * 60 * 1000;
const LEAF_LIFETIME_DAYS = 825;

interface DevelopmentCaPaths {
  directory: string;
  certificatePath: string;
  keyPath: string;
  statePath: string;
}

export interface DevelopmentCaSetupOptions {
  /** Test/isolation seam. Production callers should use LocalAppData. */
  profileRoot?: string;
  now?: Date;
  trustCurrentUserCertificate(path: string): void;
  runOpenSsl?: (arguments_: readonly string[]) => void;
}

export interface DevelopmentCaSetupResult {
  status: "created" | "unchanged";
  fingerprint: string;
  certificatePath: string;
}

export interface DevelopmentCertificateOptions {
  dataDir: string;
  hostname: string;
  /** Additional names used by the development listener. */
  aliases?: readonly string[];
  profileRoot?: string;
  now?: Date;
  runOpenSsl?: (arguments_: readonly string[]) => void;
}

export interface DevelopmentCertificate {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
}

export class DevelopmentCaPrerequisiteError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "OpenSSL is required to set up the Development CA. Install OpenSSL and verify it with `openssl version`, then run `npm run dev:ca:setup` again.",
      options,
    );
    this.name = "DevelopmentCaPrerequisiteError";
  }
}

export class DevelopmentCaUnusableError extends Error {
  constructor(detail: string, options?: ErrorOptions) {
    super(
      `Development CA unusable: ${detail}. Run \`npm run dev:ca:reset\` and then \`npm run dev:ca:setup\`; the existing identity was not repaired or rotated.`,
      options,
    );
    this.name = "DevelopmentCaUnusableError";
  }
}

export function developmentCaDirectory(profileRoot?: string): string {
  const root = profileRoot ?? process.env.LOCALAPPDATA;
  if (!root || !isAbsolute(root)) {
    throw new DevelopmentCaUnusableError(
      "the current Windows LocalAppData profile is unavailable or invalid",
    );
  }
  return join(root, "Pidex", CA_DIRECTORY);
}

export function setupDevelopmentCa(
  options: DevelopmentCaSetupOptions,
): DevelopmentCaSetupResult {
  const paths = getDevelopmentCaPaths(options.profileRoot);
  let status: DevelopmentCaSetupResult["status"];

  if (existsSync(paths.directory)) {
    validateExistingDevelopmentCa(paths, options.now);
    status = "unchanged";
  } else {
    createDevelopmentCa(paths, options);
    status = "created";
  }

  const certificate = readCertificate(paths.certificatePath);
  options.trustCurrentUserCertificate(paths.certificatePath);
  return {
    status,
    fingerprint: certificate.fingerprint256,
    certificatePath: paths.certificatePath,
  };
}

/** Issues or reuses only checkout-local leaf state. It never creates a CA. */
export function provisionDevelopmentCertificate(
  options: DevelopmentCertificateOptions,
): DevelopmentCertificate {
  const caPaths = getDevelopmentCaPaths(options.profileRoot);
  validateExistingDevelopmentCa(caPaths, options.now);

  const directory = join(options.dataDir, "development-tls");
  const certificatePath = join(directory, "leaf.pem");
  const keyPath = join(directory, "leaf-key.pem");
  const names = typedNames([
    options.hostname,
    "localhost",
    "127.0.0.1",
    "::1",
    ...(options.aliases ?? []),
  ]);
  mkdirSync(directory, { recursive: true });

  if (!leafIsReusable(
    certificatePath,
    keyPath,
    caPaths.certificatePath,
    names,
    options.now ?? new Date(),
  )) {
    issueLeaf(options, caPaths, directory, certificatePath, keyPath, names);
  }

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
    ca: readFileSync(caPaths.certificatePath),
  };
}

interface TypedName { type: "DNS" | "IP"; value: string }

function typedNames(values: readonly string[]): TypedName[] {
  const result = new Map<string, TypedName>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value || /[\n\r,]/.test(value)) {
      throw new Error(`Invalid development certificate alias: ${raw}`);
    }
    const type = isIP(value) ? "IP" : "DNS";
    const normalized = type === "DNS" ? value.toLowerCase() : normalizeIp(value);
    result.set(`${type}:${normalized}`, { type, value: normalized });
  }
  return [...result.values()].sort((a, b) =>
    `${a.type}:${a.value}`.localeCompare(`${b.type}:${b.value}`),
  );
}

function normalizeIp(value: string): string {
  if (isIP(value) === 6) {
    return new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
  }
  return value;
}

function issueLeaf(
  options: DevelopmentCertificateOptions,
  ca: DevelopmentCaPaths,
  directory: string,
  certificatePath: string,
  keyPath: string,
  names: readonly TypedName[],
): void {
  const temporaryKey = join(directory, ".leaf-key.pem");
  const request = join(directory, ".leaf.csr");
  const temporaryCertificate = join(directory, ".leaf.pem");
  const extensions = join(directory, ".leaf.ext");
  try {
    writeFileSync(extensions, [
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=${names.map(name => `${name.type}:${name.value}`).join(",")}`,
      "subjectKeyIdentifier=hash",
      "authorityKeyIdentifier=keyid,issuer",
      "",
    ].join("\n"));
    runOpenSsl(options.runOpenSsl, [
      "req", "-new", "-newkey", "rsa:2048", "-nodes",
      "-keyout", temporaryKey, "-out", request,
      "-subj", `/CN=${options.hostname}`,
    ]);
    runOpenSsl(options.runOpenSsl, [
      "x509", "-req", "-in", request,
      "-CA", ca.certificatePath, "-CAkey", ca.keyPath,
      "-set_serial", `0x${randomBytes(16).toString("hex")}`,
      "-out", temporaryCertificate, "-days", String(LEAF_LIFETIME_DAYS),
      "-sha256", "-extfile", extensions,
    ]);
    if (!leafIsReusable(
      temporaryCertificate, temporaryKey, ca.certificatePath, names,
      options.now ?? new Date(), 0,
    )) throw new Error("Generated development leaf failed validation");
    renameSync(temporaryKey, keyPath);
    renameSync(temporaryCertificate, certificatePath);
  } finally {
    for (const path of [temporaryKey, request, temporaryCertificate, extensions]) {
      rmSync(path, { force: true });
    }
  }
}

function leafIsReusable(
  certificatePath: string,
  keyPath: string,
  caPath: string,
  names: readonly TypedName[],
  now: Date,
  renewalMargin = RENEWAL_MARGIN_MS,
): boolean {
  if (!existsSync(certificatePath) || !existsSync(keyPath)) return false;
  try {
    const certificate = readCertificate(certificatePath);
    const ca = readCertificate(caPath);
    if (!certificate.checkPrivateKey(createPrivateKey(readFileSync(keyPath)))) return false;
    if (!certificate.checkIssued(ca) || !certificate.verify(ca.publicKey)) return false;
    if (now.getTime() < Date.parse(certificate.validFrom) ||
        now.getTime() + renewalMargin >= Date.parse(certificate.validTo)) return false;
    const actual = parseSubjectAltName(certificate.subjectAltName);
    if (JSON.stringify(actual) !== JSON.stringify(names)) return false;
    const text = execFileSync("openssl", ["x509", "-in", certificatePath, "-noout", "-text"], { encoding: "utf8" });
    return /Basic Constraints: critical[\s\S]*?CA:FALSE/.test(text) &&
      /Key Usage: critical[\s\S]*?Digital Signature, Key Encipherment/.test(text) &&
      /Extended Key Usage:[\s\S]*?TLS Web Server Authentication/.test(text);
  } catch {
    return false;
  }
}

function parseSubjectAltName(value: string | undefined): TypedName[] {
  if (!value) return [];
  return value.split(/,\s*/).map(part => {
    if (part.startsWith("DNS:")) return { type: "DNS" as const, value: part.slice(4).toLowerCase() };
    if (part.startsWith("IP Address:")) return { type: "IP" as const, value: normalizeIp(part.slice(11)) };
    throw new Error("Unsupported SAN type");
  }).sort((a, b) => `${a.type}:${a.value}`.localeCompare(`${b.type}:${b.value}`));
}

function getDevelopmentCaPaths(profileRoot?: string): DevelopmentCaPaths {
  const directory = developmentCaDirectory(profileRoot);
  return {
    directory,
    certificatePath: join(directory, CERTIFICATE_FILE),
    keyPath: join(directory, KEY_FILE),
    statePath: join(directory, STATE_FILE),
  };
}

function createDevelopmentCa(
  paths: DevelopmentCaPaths,
  options: DevelopmentCaSetupOptions,
): void {
  verifyOpenSsl(options.runOpenSsl);
  mkdirSync(paths.directory, { recursive: true });

  const temporaryKey = join(paths.directory, ".ca-key.pem");
  const temporaryCertificate = join(paths.directory, ".ca.pem");
  try {
    runOpenSsl(options.runOpenSsl, [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      temporaryKey,
      "-out",
      temporaryCertificate,
      "-days",
      String(TEN_YEARS_DAYS),
      "-sha256",
      "-subj",
      "/CN=Pidex Development CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-addext",
      "keyUsage=critical,keyCertSign",
    ]);
    validatePair(
      temporaryCertificate,
      temporaryKey,
      options.now ?? new Date(),
    );
    renameSync(temporaryKey, paths.keyPath);
    renameSync(temporaryCertificate, paths.certificatePath);
    writeFileSync(
      paths.statePath,
      `${JSON.stringify({ version: STATE_VERSION })}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    rmSync(paths.directory, { recursive: true, force: true });
    if (isMissingExecutable(error)) {
      throw new DevelopmentCaPrerequisiteError({ cause: error });
    }
    throw error;
  }
}

function validateExistingDevelopmentCa(
  paths: DevelopmentCaPaths,
  now?: Date,
): void {
  const requiredPaths = [
    paths.certificatePath,
    paths.keyPath,
    paths.statePath,
  ];
  if (!requiredPaths.every(existsSync)) {
    throw new DevelopmentCaUnusableError("profile state is missing or partial");
  }

  try {
    const state: unknown = JSON.parse(readFileSync(paths.statePath, "utf8"));
    if (
      typeof state !== "object" ||
      state === null ||
      !("version" in state) ||
      state.version !== STATE_VERSION
    ) {
      throw new Error("unsupported state version");
    }
  } catch (error) {
    throw new DevelopmentCaUnusableError("profile state is invalid", {
      cause: error,
    });
  }

  validatePair(paths.certificatePath, paths.keyPath, now ?? new Date());
}

function validatePair(
  certificatePath: string,
  keyPath: string,
  now: Date,
): void {
  try {
    const certificate = readCertificate(certificatePath);
    const privateKey = createPrivateKey(readFileSync(keyPath));
    const notBefore = Date.parse(certificate.validFrom);
    const notAfter = Date.parse(certificate.validTo);
    if (
      !certificate.checkIssued(certificate) ||
      !certificate.verify(certificate.publicKey)
    ) {
      throw new Error("certificate is not self-issued");
    }
    if (!certificate.checkPrivateKey(privateKey)) {
      throw new Error("private key does not match");
    }
    if (
      now.getTime() < notBefore ||
      now.getTime() + RENEWAL_MARGIN_MS >= notAfter
    ) {
      throw new Error("certificate is expired, not yet valid, or near expiry");
    }
    // Node exposes CA but not criticality/path length/key usage consistently.
    const text = execFileSync(
      "openssl",
      ["x509", "-in", certificatePath, "-noout", "-text"],
      { encoding: "utf8" },
    );
    const hasRequiredBasicConstraints =
      /X509v3 Basic Constraints: critical[\s\S]*?CA:TRUE, pathlen:0/.test(
        text,
      );
    const hasRequiredKeyUsage =
      /X509v3 Key Usage: critical[\s\S]*?Certificate Sign/.test(text);
    if (!hasRequiredBasicConstraints || !hasRequiredKeyUsage) {
      throw new Error("required CA constraints are absent");
    }
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new DevelopmentCaPrerequisiteError({ cause: error });
    }
    throw new DevelopmentCaUnusableError(
      "the certificate/key pair is invalid",
      { cause: error },
    );
  }
}

function readCertificate(path: string): X509Certificate {
  return new X509Certificate(readFileSync(path));
}

function verifyOpenSsl(runner?: (arguments_: readonly string[]) => void): void {
  try {
    runOpenSsl(runner, ["version"]);
  } catch (error) {
    throw new DevelopmentCaPrerequisiteError({ cause: error });
  }
}

function runOpenSsl(
  runner: ((arguments_: readonly string[]) => void) | undefined,
  arguments_: readonly string[],
): void {
  if (runner) {
    runner(arguments_);
    return;
  }
  execFileSync("openssl", arguments_, { stdio: "ignore" });
}

function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
