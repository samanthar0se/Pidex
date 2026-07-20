import { execFileSync } from "node:child_process";
import { X509Certificate, createPrivateKey } from "node:crypto";
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
const TEN_YEARS_DAYS = 3650;
const RENEWAL_MARGIN_MS = 30 * 24 * 60 * 60 * 1000;

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
  const directory = developmentCaDirectory(options.profileRoot);
  const certificatePath = join(directory, CERTIFICATE_FILE);
  const keyPath = join(directory, KEY_FILE);
  const statePath = join(directory, STATE_FILE);
  const anyState = existsSync(directory);
  let status: DevelopmentCaSetupResult["status"] = "unchanged";

  if (!anyState) {
    verifyOpenSsl(options.runOpenSsl);
    mkdirSync(directory, { recursive: true });
    const temporaryKey = join(directory, ".ca-key.pem");
    const temporaryCertificate = join(directory, ".ca.pem");
    try {
      runOpenSsl(options.runOpenSsl, [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", temporaryKey, "-out", temporaryCertificate,
        "-days", String(TEN_YEARS_DAYS), "-sha256",
        "-subj", "/CN=Pidex Development CA",
        "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
        "-addext", "keyUsage=critical,keyCertSign",
      ]);
      validatePair(temporaryCertificate, temporaryKey, options.now ?? new Date(), options.runOpenSsl);
      renameSync(temporaryKey, keyPath);
      renameSync(temporaryCertificate, certificatePath);
      writeFileSync(statePath, JSON.stringify({ version: 1 }) + "\n", { flag: "wx" });
      status = "created";
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      if (isMissingExecutable(error)) throw new DevelopmentCaPrerequisiteError({ cause: error });
      throw error;
    }
  } else {
    if (![certificatePath, keyPath, statePath].every(existsSync)) {
      throw new DevelopmentCaUnusableError("profile state is missing or partial");
    }
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { version?: unknown };
      if (state.version !== 1) throw new Error("unsupported state version");
    } catch (error) {
      throw new DevelopmentCaUnusableError("profile state is invalid", { cause: error });
    }
    validatePair(certificatePath, keyPath, options.now ?? new Date(), options.runOpenSsl);
  }

  const certificate = readCertificate(certificatePath);
  options.trustCurrentUserCertificate(certificatePath);
  return { status, fingerprint: certificate.fingerprint256, certificatePath };
}

function validatePair(
  certificatePath: string,
  keyPath: string,
  now: Date,
  runner?: (arguments_: readonly string[]) => void,
): void {
  try {
    const certificate = readCertificate(certificatePath);
    const privateKey = createPrivateKey(readFileSync(keyPath));
    const notBefore = Date.parse(certificate.validFrom);
    const notAfter = Date.parse(certificate.validTo);
    if (!certificate.checkIssued(certificate) || !certificate.verify(certificate.publicKey)) {
      throw new Error("certificate is not self-issued");
    }
    if (!certificate.checkPrivateKey(privateKey)) throw new Error("private key does not match");
    if (now.getTime() < notBefore || now.getTime() + RENEWAL_MARGIN_MS >= notAfter) {
      throw new Error("certificate is expired, not yet valid, or near expiry");
    }
    // Node exposes CA but not criticality/path length/key usage consistently.
    const text = execFileSync("openssl", ["x509", "-in", certificatePath, "-noout", "-text"], { encoding: "utf8" });
    if (!/X509v3 Basic Constraints: critical[\s\S]*?CA:TRUE, pathlen:0/.test(text) ||
        !/X509v3 Key Usage: critical[\s\S]*?Certificate Sign/.test(text)) {
      throw new Error("required CA constraints are absent");
    }
  } catch (error) {
    if (error instanceof DevelopmentCaPrerequisiteError) throw error;
    if (isMissingExecutable(error)) throw new DevelopmentCaPrerequisiteError({ cause: error });
    throw new DevelopmentCaUnusableError("the certificate/key pair is invalid", { cause: error });
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

function runOpenSsl(runner: ((arguments_: readonly string[]) => void) | undefined, arguments_: readonly string[]): void {
  if (runner) return runner(arguments_);
  execFileSync("openssl", arguments_, { stdio: "ignore" });
}

function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
