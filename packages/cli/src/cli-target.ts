import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface CliTarget {
  readonly trustClass: "source" | "installed";
  readonly instanceId?: string;
  readonly manifestPath: string;
}

export interface CliTargetOptions {
  readonly explicitManifestPath?: string;
  readonly checkoutDirectory?: string;
  readonly profileDirectory?: string;
}

/** Resolves one target by identity. It never scans manifests, ports, or processes. */
export function resolveCliTarget(options: CliTargetOptions): CliTarget {
  if (options.explicitManifestPath !== undefined) {
    if (!isAbsolute(options.explicitManifestPath)) {
      throw new Error("explicit manifest path must be absolute");
    }
    return { trustClass: "installed", manifestPath: resolve(options.explicitManifestPath) };
  }
  if (!options.checkoutDirectory || !options.profileDirectory) {
    throw new Error("CLI requires an explicit target or prepared checkout marker");
  }
  let marker: unknown;
  try {
    marker = JSON.parse(readFileSync(join(resolve(options.checkoutDirectory), ".pidex-source-instance.json"), "utf8"));
  } catch {
    throw new Error("CLI requires an explicit target or prepared checkout marker");
  }
  if (!isSourceMarker(marker)) throw new Error("invalid source checkout marker");
  return {
    trustClass: "source",
    instanceId: marker.instanceId,
    manifestPath: resolve(options.profileDirectory, "Pidex", "Source", marker.instanceId, "launcher", "resolved-launch-manifest.json"),
  };
}

function isSourceMarker(value: unknown): value is { schemaVersion: 1; instanceId: string } {
  return typeof value === "object" && value !== null &&
    "schemaVersion" in value && value.schemaVersion === 1 &&
    "instanceId" in value && typeof value.instanceId === "string" && value.instanceId.length > 0;
}
