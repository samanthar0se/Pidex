import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

const DEVELOPMENT_CA_CERTIFICATE_FILE = "development-ca.pem";
const DEVELOPMENT_CA_KEY_FILE = "development-ca-key.pem";
const UNUSABLE_CA_MESSAGE =
  "Development CA unusable; run reset, then setup";
const RESET_WARNING =
  "Reset affects every checkout and every previously trusted LAN client. " +
  "Run setup and repeat one-time client trust.";
const MANUAL_CLEANUP_MESSAGE =
  "The exact Development CA trust entry could not be identified or removed. " +
  "Remove the obsolete certificate from Current User Root manually, then run setup.";

export const DEVELOPMENT_CA_FILES = Object.freeze([
  DEVELOPMENT_CA_CERTIFICATE_FILE,
  DEVELOPMENT_CA_KEY_FILE,
] as const);

export interface DevelopmentCaResult {
  status: "created" | "unchanged";
  fingerprint: string;
  publicCertificatePath: string;
}

export interface DevelopmentCaResetResult {
  nextAction: "setup";
  warning: string;
  removedFingerprint?: string;
  manualCleanup?: string;
}

/** Explicit setup is the only entry point in this module that creates a CA. */
export function setupDevelopmentCa(
  profileDirectory: string,
  windows: WindowsPlatformAdapter,
): DevelopmentCaResult {
  const certificatePath =
    join(profileDirectory, DEVELOPMENT_CA_CERTIFICATE_FILE);
  const keyPath = join(profileDirectory, DEVELOPMENT_CA_KEY_FILE);
  const hadExistingState = existsSync(certificatePath) || existsSync(keyPath);
  mkdirSync(profileDirectory, { recursive: true });

  if (!hadExistingState) {
    windows.restrictToCurrentUser(profileDirectory);
    generateDevelopmentCa(certificatePath, keyPath);
  }

  if (!existsSync(certificatePath) || !existsSync(keyPath)) {
    throw new Error(UNUSABLE_CA_MESSAGE);
  }

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(readFileSync(certificatePath));
  } catch {
    throw new Error(UNUSABLE_CA_MESSAGE);
  }
  windows.trustCurrentUserCertificate(certificatePath);

  return {
    status: hadExistingState ? "unchanged" : "created",
    fingerprint: certificate.fingerprint256,
    publicCertificatePath: certificatePath,
  };
}

/** Deliberately breaks profile-wide development trust; it never creates state. */
export function resetDevelopmentCa(
  profileDirectory: string,
  windows: WindowsPlatformAdapter,
): DevelopmentCaResetResult {
  const certificatePath =
    join(profileDirectory, DEVELOPMENT_CA_CERTIFICATE_FILE);
  let removedFingerprint: string | undefined;
  let trustCleanupFailure: unknown;

  try {
    const fingerprint = new X509Certificate(
      readFileSync(certificatePath),
    ).fingerprint256;
    windows.removeCurrentUserCertificate(fingerprint);
    removedFingerprint = fingerprint;
  } catch (error) {
    trustCleanupFailure = error;
  } finally {
    for (const file of DEVELOPMENT_CA_FILES) {
      rmSync(join(profileDirectory, file), { force: true });
    }
  }

  const result: DevelopmentCaResetResult = {
    nextAction: "setup",
    warning: RESET_WARNING,
  };

  if (removedFingerprint) {
    result.removedFingerprint = removedFingerprint;
  }
  if (trustCleanupFailure) {
    result.manualCleanup = MANUAL_CLEANUP_MESSAGE;
  }

  return result;
}

function generateDevelopmentCa(
  certificatePath: string,
  keyPath: string,
): void {
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath,
      "-out", certificatePath,
      "-days", "3650",
      "-sha256",
      "-subj", "/CN=Pidex Development CA",
      "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    ],
    { stdio: "ignore" },
  );
}
