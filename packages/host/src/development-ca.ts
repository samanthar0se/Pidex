import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

export const DEVELOPMENT_CA_FILES = Object.freeze([
  "development-ca.pem",
  "development-ca-key.pem",
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
  const certificatePath = join(profileDirectory, DEVELOPMENT_CA_FILES[0]);
  const keyPath = join(profileDirectory, DEVELOPMENT_CA_FILES[1]);
  const hadState = existsSync(certificatePath) || existsSync(keyPath);
  mkdirSync(profileDirectory, { recursive: true });

  if (!hadState) {
    windows.restrictToCurrentUser(profileDirectory);
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath, "-out", certificatePath, "-days", "3650",
      "-sha256", "-subj", "/CN=Pidex Development CA",
      "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    ], { stdio: "ignore" });
  }

  if (!existsSync(certificatePath) || !existsSync(keyPath)) {
    throw new Error("Development CA unusable; run reset, then setup");
  }

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(readFileSync(certificatePath));
  } catch {
    throw new Error("Development CA unusable; run reset, then setup");
  }
  windows.trustCurrentUserCertificate(certificatePath);
  return {
    status: hadState ? "unchanged" : "created",
    fingerprint: certificate.fingerprint256,
    publicCertificatePath: certificatePath,
  };
}

/** Deliberately breaks profile-wide development trust; it never creates state. */
export function resetDevelopmentCa(
  profileDirectory: string,
  windows: WindowsPlatformAdapter,
): DevelopmentCaResetResult {
  const certificatePath = join(profileDirectory, DEVELOPMENT_CA_FILES[0]);
  let fingerprint: string | undefined;
  let trustRemoved = false;
  let cleanupFailure: unknown;

  try {
    fingerprint = new X509Certificate(readFileSync(certificatePath)).fingerprint256;
    windows.removeCurrentUserCertificate(fingerprint);
    trustRemoved = true;
  } catch (error) {
    cleanupFailure = error;
  } finally {
    for (const file of DEVELOPMENT_CA_FILES) {
      rmSync(join(profileDirectory, file), { force: true });
    }
  }

  return {
    nextAction: "setup",
    warning: "Reset affects every checkout and every previously trusted LAN client. Run setup and repeat one-time client trust.",
    ...(trustRemoved && fingerprint ? { removedFingerprint: fingerprint } : {}),
    ...(cleanupFailure ? {
      manualCleanup: "The exact Development CA trust entry could not be identified or removed. Remove the obsolete certificate from Current User Root manually, then run setup.",
    } : {}),
  };
}
