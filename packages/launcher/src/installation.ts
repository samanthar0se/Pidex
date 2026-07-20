import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";
import {
  publishImmutableFile,
  publishValidatedTree,
  replaceRebuildableFile,
  writeCandidate,
} from "../../durability/src/index.js";

export const CANONICAL_PORT = 47831;

export interface InstallationIdentity {
  schemaVersion: 1;
  hostname: string;
  port: number;
}

export interface InstallOptions {
  installDir: string;
  releaseId: string;
  signedRelease: boolean;
  bundledRuntime: string;
  windows: WindowsPlatformAdapter;
}

export function installForCurrentUser(
  options: InstallOptions,
): InstallationIdentity {
  if (!options.signedRelease) {
    throw new Error("Refusing to install an unsigned release");
  }
  if (!existsSync(options.bundledRuntime)) {
    throw new Error("Bundled runtime is missing");
  }

  mkdirSync(options.installDir, { recursive: true });
  const identityPath = join(options.installDir, "identity.json");
  const identity = loadOrCreateIdentity(identityPath);

  const releaseDir = join(options.installDir, "releases", options.releaseId);
  publishValidatedTree({
    target: releaseDir,
    materialize() {},
    validate: path => existsSync(path),
  });
  replaceRebuildableFile({
    target: join(options.installDir, "active-release"),
    materialize: writeCandidate(options.releaseId),
    validate: path => readFileSync(path, "utf8") === options.releaseId,
  });
  options.windows.restrictToCurrentUser(options.installDir);
  options.windows.registerLogonTask(
    join(options.installDir, "pidex-launcher.exe"),
    ["start"],
  );
  return identity;
}

function loadOrCreateIdentity(identityPath: string): InstallationIdentity {
  if (existsSync(identityPath)) {
    return parseInstallationIdentity(readFileSync(identityPath, "utf8"));
  }

  const identity: InstallationIdentity = {
    schemaVersion: 1,
    hostname: `pidex-${randomBytes(10).toString("hex")}.local`,
    port: CANONICAL_PORT,
  };
  const serialized = JSON.stringify(identity, null, 2);
  publishImmutableFile({
    target: identityPath,
    materialize: writeCandidate(serialized),
    validate(path) {
      parseInstallationIdentity(readFileSync(path, "utf8"));
    },
  });
  return identity;
}

function parseInstallationIdentity(
  serializedIdentity: string,
): InstallationIdentity {
  const identity: unknown = JSON.parse(serializedIdentity);
  if (!isInstallationIdentity(identity)) {
    throw new Error("Installation identity is invalid");
  }

  return identity;
}

function isInstallationIdentity(
  identity: unknown,
): identity is InstallationIdentity {
  if (typeof identity !== "object" || identity === null) {
    return false;
  }

  return (
    "schemaVersion" in identity &&
    identity.schemaVersion === 1 &&
    "hostname" in identity &&
    typeof identity.hostname === "string" &&
    "port" in identity &&
    typeof identity.port === "number"
  );
}
