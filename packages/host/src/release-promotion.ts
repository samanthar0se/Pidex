export const SOAK_CAPACITY_TIERS = ["8-gib", "16-gib"] as const;
export const DAILY_DRIVER_OPERATIONS = [
  "prompt", "steering", "follow-up", "interaction-response", "stop",
  "timeline-settlement", "maintenance",
] as const;
export const PROMOTION_GATES = [
  "clean-install", "supported-prior-upgrades", "pre-acceptance-rollback",
  "uninstall-reinstall-data-preservation", "browser-capacity-matrix",
  "security-automation", "pi-contracts", "fault-recovery", "soak",
  "daily-driver",
] as const;

type Trace = {
  build: string;
  environment: string;
  configuration: string;
  artifacts: readonly string[];
};
type Tier = (typeof SOAK_CAPACITY_TIERS)[number];
type Operation = (typeof DAILY_DRIVER_OPERATIONS)[number];
type Gate = (typeof PROMOTION_GATES)[number];

export interface SoakResult extends Trace {
  tier: Tier; durationHours: number; invariantViolations: number;
  daemonCrashes: number; stuckAcceptedWork: number; convergenceFailures: number;
  unboundedQueueGrowth: boolean; resourceLimitFailures: number;
  equivalentQuiescence: boolean; memoryGrowthPercent: number;
  handleSamples: readonly number[]; diagnosticBytes: number;
}
export interface DailyDriverResult extends Trace {
  durationDays: number; desktopUsed: boolean; mobileUsed: boolean;
  otherPiUiCoreActions: number;
  operations: Partial<Record<Operation, { accepted: number; settled: number; unique: number }>>;
}
export interface GateResult extends Trace { gate: Gate; passed: boolean }
export interface Defect { id: string; severity: 1 | 2 | 3; status: "open" | "closed"; workaround?: string; scope?: string; owner?: string; followUp?: string }
export interface Waiver { id: string; externalDefect: string; safeFallback: string; guaranteesPreserved: boolean }
export interface Impact { change: string; affectedGates: readonly Gate[]; rerunGates: readonly Gate[] }
export interface Boundaries { accessibility: string; observability: string; wcagClaimed: boolean; telemetryClaimed: boolean; penetrationTestClaimed: boolean; workerSandboxClaimed: boolean }

export class ReleasePromotion {
  readonly #soaks = new Map<Tier, SoakResult>();
  #daily?: DailyDriverResult;
  readonly #gates = new Map<Gate, GateResult>();
  readonly #defects: Defect[] = [];
  readonly #waivers: Waiver[] = [];
  readonly #impacts: Impact[] = [];
  #boundaries?: Boundaries;

  constructor(readonly build: string) { if (!build.trim()) throw new Error("promotion-build-required"); }
  recordSoak(value: SoakResult): void {
    validateTrace(value, this.build);
    const prior = this.#soaks.get(value.tier);
    if (!prior || soakFailed(value) || !soakFailed(prior)) this.#soaks.set(value.tier, structuredClone(value));
  }
  recordDailyDriver(value: DailyDriverResult): void {
    validateTrace(value, this.build);
    if (!this.#daily || dailyFailed(value) || !dailyFailed(this.#daily)) this.#daily = structuredClone(value);
  }
  recordGate(value: GateResult): void {
    validateTrace(value, this.build);
    const prior = this.#gates.get(value.gate);
    // A rerun can add diagnosis, but cannot erase a failure for this build.
    if (!prior || value.passed === false) this.#gates.set(value.gate, structuredClone(value));
  }
  recordDefect(value: Defect): void { this.#defects.push({ ...value }); }
  recordWaiver(value: Waiver): void { this.#waivers.push({ ...value }); }
  recordImpact(value: Impact): void { this.#impacts.push(structuredClone(value)); }
  recordBoundaries(value: Boundaries): void { this.#boundaries = { ...value }; }

  evaluate() {
    const missing: string[] = [];
    const failures: string[] = [];
    for (const tier of SOAK_CAPACITY_TIERS) {
      const soak = this.#soaks.get(tier);
      if (!soak) { missing.push(`soak:${tier}`); continue; }
      if (soak.durationHours < 72) failures.push(`soak:${tier}:duration<72h`);
      for (const [name, count] of [["invariant-violation", soak.invariantViolations], ["daemon-crash", soak.daemonCrashes], ["stuck-accepted-work", soak.stuckAcceptedWork], ["client-convergence", soak.convergenceFailures], ["resource-limit", soak.resourceLimitFailures]] as const)
        if (count !== 0) failures.push(`soak:${tier}:${name}`);
      if (soak.unboundedQueueGrowth) failures.push(`soak:${tier}:unbounded-queue-growth`);
      if (!soak.equivalentQuiescence) failures.push(`soak:${tier}:not-equivalent-quiescence`);
      if (soak.memoryGrowthPercent > 10) failures.push(`soak:${tier}:memory-growth>10%`);
      if (strictlyIncreasing(soak.handleSamples)) failures.push(`soak:${tier}:handles-monotonic`);
      if (soak.diagnosticBytes > 1024 ** 3) failures.push(`soak:${tier}:diagnostics>1GiB`);
    }
    if (!this.#daily) missing.push("daily-driver");
    else {
      const d = this.#daily;
      if (d.durationDays < 7) failures.push("daily-driver:duration<7d");
      if (!d.desktopUsed || !d.mobileUsed) failures.push("daily-driver:desktop-and-mobile-required");
      if (d.otherPiUiCoreActions !== 0) failures.push("daily-driver:other-pi-ui-used");
      for (const operation of DAILY_DRIVER_OPERATIONS) {
        const result = d.operations[operation];
        if (!result) { missing.push(`daily-driver:${operation}`); continue; }
        if (result.accepted !== result.settled) failures.push(`daily-driver:${operation}:lost-or-outcome-less`);
        if (result.unique !== result.accepted) failures.push(`daily-driver:${operation}:duplicated`);
      }
    }
    for (const gate of PROMOTION_GATES) {
      const result = this.#gates.get(gate);
      if (!result) missing.push(`gate:${gate}`);
      else if (!result.passed) failures.push(`gate:${gate}:failed`);
    }
    for (const defect of this.#defects.filter(d => d.status === "open")) {
      if (defect.severity <= 2) failures.push(`defect:${defect.id}:severity-${defect.severity}`);
      else if (![defect.workaround, defect.scope, defect.owner, defect.followUp].every(Boolean)) failures.push(`defect:${defect.id}:severity-3-incomplete`);
    }
    for (const waiver of this.#waivers) if (!waiver.externalDefect.trim() || !waiver.safeFallback.trim() || !waiver.guaranteesPreserved) failures.push(`waiver:${waiver.id}:weakens-guarantee`);
    for (const impact of this.#impacts) for (const gate of impact.affectedGates) if (!impact.rerunGates.includes(gate)) failures.push(`impact:${impact.change}:${gate}-not-rerun`);
    if (!this.#boundaries) missing.push("accessibility-observability-boundaries");
    else if (!this.#boundaries.accessibility.trim() || !this.#boundaries.observability.trim() || this.#boundaries.wcagClaimed || this.#boundaries.telemetryClaimed || this.#boundaries.penetrationTestClaimed || this.#boundaries.workerSandboxClaimed) failures.push("unsupported-boundary-claim");
    return { schema: "pidex-release-promotion-v1" as const, build: this.build, missing, failures, passed: missing.length === 0 && failures.length === 0 };
  }
}

function validateTrace(value: Trace, build: string): void {
  if (value.build !== build || !value.environment.trim() || !value.configuration.trim() || value.artifacts.length === 0 || value.artifacts.some(a => !a.trim())) throw new Error("incomplete-or-mismatched-trace");
}
function strictlyIncreasing(values: readonly number[]): boolean { return values.length > 1 && values.every((value, index) => index === 0 || value > values[index - 1]!); }
function soakFailed(value: SoakResult): boolean {
  return value.durationHours < 72 || value.invariantViolations !== 0 || value.daemonCrashes !== 0 || value.stuckAcceptedWork !== 0 || value.convergenceFailures !== 0 || value.unboundedQueueGrowth || value.resourceLimitFailures !== 0 || !value.equivalentQuiescence || value.memoryGrowthPercent > 10 || strictlyIncreasing(value.handleSamples) || value.diagnosticBytes > 1024 ** 3;
}
function dailyFailed(value: DailyDriverResult): boolean {
  return value.durationDays < 7 || !value.desktopUsed || !value.mobileUsed || value.otherPiUiCoreActions !== 0 || DAILY_DRIVER_OPERATIONS.some(operation => {
    const result = value.operations[operation];
    return !result || result.accepted !== result.settled || result.unique !== result.accepted;
  });
}
