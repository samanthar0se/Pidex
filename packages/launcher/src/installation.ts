import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

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

export function installForCurrentUser(options: InstallOptions): InstallationIdentity {
  if (!options.signedRelease) throw new Error("Refusing to install an unsigned release");
  if (!existsSync(options.bundledRuntime)) throw new Error("Bundled runtime is missing");

  mkdirSync(options.installDir, { recursive: true });
  const identityPath = join(options.installDir, "identity.json");
  const identity: InstallationIdentity = existsSync(identityPath)
    ? JSON.parse(readFileSync(identityPath, "utf8")) as InstallationIdentity
    : {
        schemaVersion: 1,
        hostname: `pidex-${randomBytes(10).toString("hex")}.local`,
        port: CANONICAL_PORT,
      };
  if (!existsSync(identityPath)) writeFileSync(identityPath, JSON.stringify(identity, null, 2));

  const releaseDir = join(options.installDir, "releases", options.releaseId);
  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(join(options.installDir, "active-release"), options.releaseId);
  options.windows.restrictToCurrentUser(options.installDir);
  options.windows.registerLogonTask(join(options.installDir, "pidex-launcher.exe"), ["start"]);
  return identity;
}
