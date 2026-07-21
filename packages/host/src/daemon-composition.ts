import {
  parseResolvedLaunchManifest,
  type ResolvedLaunchManifest,
} from "../../launch-manifest/src/index.js";

export type HealthScope =
  | "local-control" | "authority" | "lan" | "tls-origin" | "firewall"
  | "private-interfaces" | "mdns" | "pi-configuration" | "durability-coverage"
  | "optional-capabilities" | `session:${string}`;
export type Availability = "pending" | "available" | "degraded" | "unavailable" | "recovery-only";
export type HealthFreshness = "current" | "stale";
export type HealthSeverity = "info" | "warning" | "error" | "critical";
export type HealthRetryability = "automatic" | "manual" | "not-retryable";
export type HealthCode = string;
export type HealthStage = string;
export type HealthObservationTime = string;
export type HealthInstanceId = string;
export type HealthReleaseId = string;
export type HealthConfigGeneration = number;

export interface HealthState {
  readonly scope: HealthScope;
  readonly availability: Availability;
  readonly freshness: HealthFreshness;
  readonly code: HealthCode;
  readonly stage?: HealthStage;
  readonly severity?: HealthSeverity;
  readonly retryability?: HealthRetryability;
  readonly firstObservedAt?: HealthObservationTime;
  readonly latestObservedAt?: HealthObservationTime;
  readonly instanceId?: HealthInstanceId;
  readonly releaseId?: HealthReleaseId;
  readonly configGeneration?: HealthConfigGeneration;
  readonly evidence?: Readonly<Record<string, string | number | boolean>>;
  readonly remediation?: string;
}

export interface HealthFinding {
  readonly code: HealthCode;
  readonly scope: HealthScope;
  readonly stage: HealthStage;
  readonly severity: HealthSeverity;
  readonly availability: Availability;
  readonly retryability: HealthRetryability;
  readonly observedAt: HealthObservationTime;
  readonly freshness?: HealthFreshness;
  readonly instanceId?: HealthInstanceId;
  readonly releaseId?: HealthReleaseId;
  readonly configGeneration?: HealthConfigGeneration;
  /** Redacted, bounded evidence only. */
  readonly evidence?: Readonly<Record<string, string | number | boolean>>;
  readonly remediation?: string;
}

export class HostHealthGraph {
  readonly #states = new Map<HealthScope, HealthState>();
  readonly #baselines = new Map<HealthScope, HealthState>();
  readonly #findings = new Map<string, HealthState>();
  constructor(scopes: readonly HealthScope[]) {
    for (const scope of scopes) this.set(scope, "pending", "not-assessed");
  }
  scope(scope: HealthScope): HealthState {
    const state = this.#states.get(scope);
    if (!state) throw new Error(`unknown health scope: ${scope}`);
    return state;
  }
  states(): readonly HealthState[] { return [...this.#states.values()]; }
  findings(): readonly HealthState[] { return [...this.#findings.values()]; }
  set(scope: HealthScope, availability: Availability, code: HealthCode, remediation?: string): void {
    const state = Object.freeze({ scope, availability, freshness: "current" as const, code, ...(remediation ? { remediation } : {}) });
    this.#baselines.set(scope, state);
    if (![...this.#findings.values()].some(finding => finding.scope === scope)) this.#states.set(scope, state);
  }
  report(finding: HealthFinding): void {
    const key = findingKey(finding.scope, finding.code);
    const existing = this.#findings.get(key);
    if (!this.#baselines.has(finding.scope) && !finding.scope.startsWith("session:")) {
      throw new Error(`unknown health scope: ${finding.scope}`);
    }
    if (!this.#baselines.has(finding.scope)) this.set(finding.scope, "available", "generation-ready");
    const state: HealthState = Object.freeze({
      scope: finding.scope,
      availability: finding.availability,
      freshness: finding.freshness ?? "current",
      code: finding.code,
      stage: finding.stage,
      severity: finding.severity,
      retryability: finding.retryability,
      firstObservedAt: existing?.firstObservedAt ?? finding.observedAt,
      latestObservedAt: finding.observedAt,
      ...(finding.instanceId ? { instanceId: finding.instanceId } : {}),
      ...(finding.releaseId ? { releaseId: finding.releaseId } : {}),
      ...(finding.configGeneration !== undefined ? { configGeneration: finding.configGeneration } : {}),
      ...(finding.evidence ? { evidence: Object.freeze({ ...finding.evidence }) } : {}),
      ...(finding.remediation ? { remediation: finding.remediation } : {}),
    });
    this.#findings.set(key, state);
    this.#states.set(finding.scope, state);
  }
  resolve(scope: HealthScope, code: HealthCode): void {
    const key = findingKey(scope, code);
    const finding = this.#findings.get(key);
    if (!finding) return;
    this.#findings.delete(key);
    const remaining = [...this.#findings.values()].reverse().find(candidate => candidate.scope === finding.scope);
    this.#states.set(finding.scope, remaining ?? this.#baselines.get(finding.scope)!);
  }
}

function findingKey(scope: HealthScope, code: HealthCode): string {
  return `${scope}\0${code}`;
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
