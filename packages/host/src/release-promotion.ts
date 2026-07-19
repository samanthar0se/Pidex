export const SOAK_CAPACITY_TIERS = ["8-gib", "16-gib"] as const;
export const DAILY_DRIVER_OPERATIONS = [
  "prompt",
  "steering",
  "follow-up",
  "interaction-response",
  "stop",
  "timeline-settlement",
  "maintenance",
] as const;
export const PROMOTION_GATES = [
  "clean-install",
  "supported-prior-upgrades",
  "pre-acceptance-rollback",
  "uninstall-reinstall-data-preservation",
  "browser-capacity-matrix",
  "security-automation",
  "pi-contracts",
  "fault-recovery",
  "soak",
  "daily-driver",
] as const;

const MINIMUM_SOAK_DURATION_HOURS = 72;
const MAXIMUM_SOAK_MEMORY_GROWTH_PERCENT = 10;
const MAXIMUM_DIAGNOSTIC_BYTES = 1024 ** 3;
const MINIMUM_DAILY_DRIVER_DURATION_DAYS = 7;

type Tier = (typeof SOAK_CAPACITY_TIERS)[number];
type Operation = (typeof DAILY_DRIVER_OPERATIONS)[number];
type Gate = (typeof PROMOTION_GATES)[number];

interface Trace {
  build: string;
  environment: string;
  configuration: string;
  artifacts: readonly string[];
}

interface OperationResult {
  accepted: number;
  settled: number;
  unique: number;
}

interface EvidenceIssues {
  missing: string[];
  failures: string[];
}

export interface SoakResult extends Trace {
  tier: Tier;
  durationHours: number;
  invariantViolations: number;
  daemonCrashes: number;
  stuckAcceptedWork: number;
  convergenceFailures: number;
  unboundedQueueGrowth: boolean;
  resourceLimitFailures: number;
  equivalentQuiescence: boolean;
  memoryGrowthPercent: number;
  handleSamples: readonly number[];
  diagnosticBytes: number;
}

export interface DailyDriverResult extends Trace {
  durationDays: number;
  desktopUsed: boolean;
  mobileUsed: boolean;
  otherPiUiCoreActions: number;
  operations: Partial<Record<Operation, OperationResult>>;
}

export interface GateResult extends Trace {
  gate: Gate;
  passed: boolean;
}

export interface Defect {
  id: string;
  severity: 1 | 2 | 3;
  status: "open" | "closed";
  workaround?: string;
  scope?: string;
  owner?: string;
  followUp?: string;
}

export interface Waiver {
  id: string;
  externalDefect: string;
  safeFallback: string;
  guaranteesPreserved: boolean;
}

export interface Impact {
  change: string;
  affectedGates: readonly Gate[];
  rerunGates: readonly Gate[];
}

export interface Boundaries {
  accessibility: string;
  observability: string;
  wcagClaimed: boolean;
  telemetryClaimed: boolean;
  penetrationTestClaimed: boolean;
  workerSandboxClaimed: boolean;
}

export interface ReleasePromotionEvidence extends EvidenceIssues {
  schema: "pidex-release-promotion-v1";
  build: string;
  passed: boolean;
}

/** Collects release evidence without allowing a successful rerun to erase a failure. */
export class ReleasePromotion {
  readonly #soaks = new Map<Tier, SoakResult>();
  #dailyDriver?: DailyDriverResult;
  readonly #gates = new Map<Gate, GateResult>();
  readonly #defects: Defect[] = [];
  readonly #waivers: Waiver[] = [];
  readonly #impacts: Impact[] = [];
  #boundaries?: Boundaries;

  constructor(readonly build: string) {
    if (!build.trim()) {
      throw new Error("promotion-build-required");
    }
  }

  recordSoak(soak: SoakResult): void {
    validateTrace(soak, this.build);
    const priorSoak = this.#soaks.get(soak.tier);
    const wouldEraseFailure =
      priorSoak !== undefined &&
      soakHasFailures(priorSoak) &&
      !soakHasFailures(soak);

    if (!wouldEraseFailure) {
      this.#soaks.set(soak.tier, structuredClone(soak));
    }
  }

  recordDailyDriver(dailyDriver: DailyDriverResult): void {
    validateTrace(dailyDriver, this.build);
    const wouldEraseFailure =
      this.#dailyDriver !== undefined &&
      dailyDriverHasFailures(this.#dailyDriver) &&
      !dailyDriverHasFailures(dailyDriver);

    if (!wouldEraseFailure) {
      this.#dailyDriver = structuredClone(dailyDriver);
    }
  }

  recordGate(gateResult: GateResult): void {
    validateTrace(gateResult, this.build);
    const priorResult = this.#gates.get(gateResult.gate);

    if (!priorResult || !gateResult.passed) {
      this.#gates.set(gateResult.gate, structuredClone(gateResult));
    }
  }

  recordDefect(defect: Defect): void {
    this.#defects.push({ ...defect });
  }

  recordWaiver(waiver: Waiver): void {
    this.#waivers.push({ ...waiver });
  }

  recordImpact(impact: Impact): void {
    this.#impacts.push(structuredClone(impact));
  }

  recordBoundaries(boundaries: Boundaries): void {
    this.#boundaries = { ...boundaries };
  }

  evaluate(): ReleasePromotionEvidence {
    const missing: string[] = [];
    const failures: string[] = [];

    this.evaluateSoaks(missing, failures);
    this.evaluateDailyDriver(missing, failures);
    this.evaluateGates(missing, failures);
    this.evaluateDefects(failures);
    this.evaluateWaivers(failures);
    this.evaluateImpacts(failures);
    this.evaluateBoundaries(missing, failures);

    return {
      schema: "pidex-release-promotion-v1",
      build: this.build,
      missing,
      failures,
      passed: missing.length === 0 && failures.length === 0,
    };
  }

  private evaluateSoaks(missing: string[], failures: string[]): void {
    for (const tier of SOAK_CAPACITY_TIERS) {
      const soak = this.#soaks.get(tier);
      if (!soak) {
        missing.push(`soak:${tier}`);
        continue;
      }

      for (const failure of soakFailureReasons(soak)) {
        failures.push(`soak:${tier}:${failure}`);
      }
    }
  }

  private evaluateDailyDriver(
    missing: string[],
    failures: string[],
  ): void {
    if (!this.#dailyDriver) {
      missing.push("daily-driver");
      return;
    }

    const issues = dailyDriverIssues(this.#dailyDriver);
    missing.push(...issues.missing);
    failures.push(...issues.failures);
  }

  private evaluateGates(missing: string[], failures: string[]): void {
    for (const gate of PROMOTION_GATES) {
      const result = this.#gates.get(gate);
      if (!result) {
        missing.push(`gate:${gate}`);
      } else if (!result.passed) {
        failures.push(`gate:${gate}:failed`);
      }
    }
  }

  private evaluateDefects(failures: string[]): void {
    for (const defect of this.#defects) {
      if (defect.status === "closed") {
        continue;
      }

      if (defect.severity <= 2) {
        failures.push(`defect:${defect.id}:severity-${defect.severity}`);
      } else if (!hasCompleteSeverityThreeDisposition(defect)) {
        failures.push(`defect:${defect.id}:severity-3-incomplete`);
      }
    }
  }

  private evaluateWaivers(failures: string[]): void {
    for (const waiver of this.#waivers) {
      const isInvalid =
        !waiver.externalDefect.trim() ||
        !waiver.safeFallback.trim() ||
        !waiver.guaranteesPreserved;
      if (isInvalid) {
        failures.push(`waiver:${waiver.id}:weakens-guarantee`);
      }
    }
  }

  private evaluateImpacts(failures: string[]): void {
    for (const impact of this.#impacts) {
      for (const gate of impact.affectedGates) {
        if (!impact.rerunGates.includes(gate)) {
          failures.push(`impact:${impact.change}:${gate}-not-rerun`);
        }
      }
    }
  }

  private evaluateBoundaries(missing: string[], failures: string[]): void {
    if (!this.#boundaries) {
      missing.push("accessibility-observability-boundaries");
      return;
    }

    if (hasUnsupportedBoundaryClaim(this.#boundaries)) {
      failures.push("unsupported-boundary-claim");
    }
  }
}

function validateTrace(trace: Trace, expectedBuild: string): void {
  const isIncompleteOrMismatched =
    trace.build !== expectedBuild ||
    !trace.environment.trim() ||
    !trace.configuration.trim() ||
    trace.artifacts.length === 0 ||
    trace.artifacts.some(artifact => !artifact.trim());

  if (isIncompleteOrMismatched) {
    throw new Error("incomplete-or-mismatched-trace");
  }
}

function soakFailureReasons(soak: SoakResult): string[] {
  const failures: string[] = [];

  if (soak.durationHours < MINIMUM_SOAK_DURATION_HOURS) {
    failures.push("duration<72h");
  }

  const nonzeroCounts = [
    ["invariant-violation", soak.invariantViolations],
    ["daemon-crash", soak.daemonCrashes],
    ["stuck-accepted-work", soak.stuckAcceptedWork],
    ["client-convergence", soak.convergenceFailures],
    ["resource-limit", soak.resourceLimitFailures],
  ] as const;
  for (const [failure, count] of nonzeroCounts) {
    if (count !== 0) {
      failures.push(failure);
    }
  }

  if (soak.unboundedQueueGrowth) {
    failures.push("unbounded-queue-growth");
  }
  if (!soak.equivalentQuiescence) {
    failures.push("not-equivalent-quiescence");
  }
  if (soak.memoryGrowthPercent > MAXIMUM_SOAK_MEMORY_GROWTH_PERCENT) {
    failures.push("memory-growth>10%");
  }
  if (strictlyIncreasing(soak.handleSamples)) {
    failures.push("handles-monotonic");
  }
  if (soak.diagnosticBytes > MAXIMUM_DIAGNOSTIC_BYTES) {
    failures.push("diagnostics>1GiB");
  }

  return failures;
}

function soakHasFailures(soak: SoakResult): boolean {
  return soakFailureReasons(soak).length > 0;
}

function dailyDriverIssues(dailyDriver: DailyDriverResult): EvidenceIssues {
  const missing: string[] = [];
  const failures: string[] = [];

  if (dailyDriver.durationDays < MINIMUM_DAILY_DRIVER_DURATION_DAYS) {
    failures.push("daily-driver:duration<7d");
  }
  if (!dailyDriver.desktopUsed || !dailyDriver.mobileUsed) {
    failures.push("daily-driver:desktop-and-mobile-required");
  }
  if (dailyDriver.otherPiUiCoreActions !== 0) {
    failures.push("daily-driver:other-pi-ui-used");
  }

  for (const operation of DAILY_DRIVER_OPERATIONS) {
    const result = dailyDriver.operations[operation];
    if (!result) {
      missing.push(`daily-driver:${operation}`);
      continue;
    }
    if (result.accepted !== result.settled) {
      failures.push(`daily-driver:${operation}:lost-or-outcome-less`);
    }
    if (result.unique !== result.accepted) {
      failures.push(`daily-driver:${operation}:duplicated`);
    }
  }

  return { missing, failures };
}

function dailyDriverHasFailures(dailyDriver: DailyDriverResult): boolean {
  const issues = dailyDriverIssues(dailyDriver);
  return issues.missing.length > 0 || issues.failures.length > 0;
}

function strictlyIncreasing(values: readonly number[]): boolean {
  return (
    values.length > 1 &&
    values.every(
      (value, index) => index === 0 || value > values[index - 1]!,
    )
  );
}

function hasCompleteSeverityThreeDisposition(defect: Defect): boolean {
  return [defect.workaround, defect.scope, defect.owner, defect.followUp].every(
    Boolean,
  );
}

function hasUnsupportedBoundaryClaim(boundaries: Boundaries): boolean {
  return (
    !boundaries.accessibility.trim() ||
    !boundaries.observability.trim() ||
    boundaries.wcagClaimed ||
    boundaries.telemetryClaimed ||
    boundaries.penetrationTestClaimed ||
    boundaries.workerSandboxClaimed
  );
}
