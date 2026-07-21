import {
  parseResolvedLaunchManifest,
  type ResolvedLaunchManifest,
} from "../../launch-manifest/src/index.js";

export type HealthScope =
  | "local-control" | "authority" | "lan" | "tls-origin" | "firewall"
  | "private-interfaces" | "mdns" | "pi-configuration" | "durability-coverage"
  | "optional-capabilities" | `session:${string}`;
export type Availability = "pending" | "available" | "degraded" | "unavailable" | "recovery-only";

export interface HealthState {
  readonly scope: HealthScope;
  readonly availability: Availability;
  readonly code: string;
  readonly remediation?: string;
}

export class HostHealthGraph {
  readonly #states = new Map<HealthScope, HealthState>();
  constructor(scopes: readonly HealthScope[]) {
    for (const scope of scopes) this.set(scope, "pending", "not-assessed");
  }
  scope(scope: HealthScope): HealthState {
    const state = this.#states.get(scope);
    if (!state) throw new Error(`unknown health scope: ${scope}`);
    return state;
  }
  states(): readonly HealthState[] { return [...this.#states.values()]; }
  set(scope: HealthScope, availability: Availability, code: string, remediation?: string): void {
    this.#states.set(scope, Object.freeze({ scope, availability, code, ...(remediation ? { remediation } : {}) }));
  }
}

export interface CompositionOwner { close(): Promise<void>; }
export interface AuthorityOwner extends CompositionOwner { readonly mode: "normal" | "recovery-only"; }

/** Runtime construction ports. Each returned owner has one lexical owner in this composition root. */
export interface ManifestHostFactories {
  proveLauncherContainment(manifest: ResolvedLaunchManifest): Promise<void>;
  openAuthenticatedLocalControl(manifest: ResolvedLaunchManifest): Promise<CompositionOwner>;
  verifyReleaseAndNativeIdentity(manifest: ResolvedLaunchManifest): Promise<void>;
  openAuthority(manifest: ResolvedLaunchManifest): Promise<AuthorityOwner>;
  probePi(manifest: ResolvedLaunchManifest): Promise<void>;
  openLan(manifest: ResolvedLaunchManifest, health: HostHealthGraph): Promise<CompositionOwner>;
  openRunAdmission(manifest: ResolvedLaunchManifest): Promise<CompositionOwner>;
}

export interface ManifestHost extends CompositionOwner {
  readonly manifest: ResolvedLaunchManifest;
  readonly mode: "normal" | "recovery-only";
  readonly health: HostHealthGraph;
}

const SCOPES: readonly HealthScope[] = [
  "local-control", "authority", "lan", "tls-origin", "firewall",
  "private-interfaces", "mdns", "pi-configuration", "durability-coverage",
  "optional-capabilities",
];

/**
 * Sole daemon startup ordering boundary. Parsing is repeated here so callers
 * cannot bypass manifest guards with a cast or a product adapter selector.
 */
export async function composeManifestHost(
  input: ResolvedLaunchManifest,
  factories: ManifestHostFactories,
): Promise<ManifestHost> {
  const manifest = parseResolvedLaunchManifest(input);
  if (manifest.execution.implementation !== "real") {
    throw new Error("product Host requires a real resolved launch manifest");
  }
  const health = new HostHealthGraph(SCOPES);
  const owners: CompositionOwner[] = [];
  try {
    await factories.proveLauncherContainment(manifest);
    const control = await factories.openAuthenticatedLocalControl(manifest);
    owners.push(control);
    health.set("local-control", "available", "authenticated");

    await factories.verifyReleaseAndNativeIdentity(manifest);
    const authority = await factories.openAuthority(manifest);
    owners.push(authority);
    health.set("authority", authority.mode === "normal" ? "available" : "recovery-only", authority.mode);

    if (authority.mode === "normal") {
      await factories.probePi(manifest);
      health.set("pi-configuration", "available", "static-probe-passed");
      owners.push(await factories.openLan(manifest, health));
      health.set("lan", "available", "edge-open");
      owners.push(await factories.openRunAdmission(manifest));
    } else {
      health.set("lan", "unavailable", "authority-recovery-only", "Complete local Authority recovery");
      health.set("pi-configuration", "unavailable", "authority-recovery-only");
    }

    let closed = false;
    return {
      manifest, mode: authority.mode, health,
      async close() {
        if (closed) return;
        closed = true;
        await closeOwners(owners);
      },
    };
  } catch (cause) {
    await closeOwners(owners);
    throw cause;
  }
}

async function closeOwners(owners: readonly CompositionOwner[]): Promise<void> {
  const failures: unknown[] = [];
  for (const owner of [...owners].reverse()) {
    try { await owner.close(); } catch (cause) { failures.push(cause); }
  }
  if (failures.length) throw new AggregateError(failures, "Host owner shutdown failed");
}
