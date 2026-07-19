export const FAULT_BOUNDARIES = [
  "command-acceptance",
  "dispatch",
  "checkpoint",
  "blob-publication",
  "settlement",
  "snapshot-barrier",
  "migration-activation",
  "release-activation",
  "backup-verification",
  "restore-activation",
  "reidentify",
] as const;

export const FAULT_PHASES = ["before", "after"] as const;

export const FAULT_SCENARIOS = {
  process: [
    "uncooperative-descendants",
    "worker-termination",
    "daemon-termination",
    "launcher-termination",
    "job-loss",
    "host-reboot",
    "power-loss",
    "startup-circuit-breaker",
    "multi-session-isolation",
  ],
  transport: [
    "dropped-traffic",
    "duplicated-traffic",
    "reordered-traffic",
    "delayed-traffic",
    "coalesced-traffic",
    "slow-client",
    "device-revocation-race",
    "command-interaction-race",
  ],
  storageTime: [
    "wall-clock-forward",
    "wall-clock-backward",
    "disk-full",
    "permission-denied",
    "partial-write",
    "reserve-exhaustion",
    "orphan-cleanup",
    "corrupt-sqlite",
    "corrupt-blob",
    "corrupt-pi-artifact",
    "corrupt-snapshot",
    "corrupt-manifest",
    "corrupt-newest-recovery-point",
  ],
  securityOperations: [
    "certificate-expiry",
    "certificate-rotation",
    "firewall-drift",
    "pairing-attack",
    "malformed-ipc",
    "malformed-protocol",
    "update-download-failure",
    "update-signature-failure",
    "update-migration-failure",
    "interrupted-backup",
    "interrupted-restore",
    "redaction",
    "privileged-helper-misuse",
  ],
} as const;

export const RECOVERY_DRILLS = [
  "clean-online-restore",
  "executing-tail-restore",
  "corrupt-newest-fallback",
  "failed-migration-rollback",
  "identity-preserving-portable-restore",
  "revocation-rollback-disclosure",
  "reidentify",
] as const;

export const CAMPAIGN_INVARIANTS = [
  "single-host-authority",
  "accepted-work-has-one-ordered-outcome",
  "no-uncertain-replay",
  "smallest-provable-scope",
] as const;

export type FaultBoundary = (typeof FAULT_BOUNDARIES)[number];
export type FaultPhase = (typeof FAULT_PHASES)[number];
export type FaultScenario =
  (typeof FAULT_SCENARIOS)[keyof typeof FAULT_SCENARIOS][number];
export type RecoveryDrill = (typeof RECOVERY_DRILLS)[number];
export type CampaignInvariant = (typeof CAMPAIGN_INVARIANTS)[number];

export interface FaultObservation {
  id: string;
  kind: "boundary" | "scenario" | "recovery";
  boundary?: FaultBoundary;
  phase?: FaultPhase;
  scenario?: FaultScenario;
  recovery?: RecoveryDrill;
  attempt?: number;
  deterministic: boolean;
  passed: boolean;
  invariants: Partial<Record<CampaignInvariant, boolean>>;
  diagnostics?: string;
}

export interface FaultCampaignEvidence {
  schema: "pidex-fault-campaign-v1";
  build: string;
  observations: readonly FaultObservation[];
  missing: string[];
  failures: string[];
  passed: boolean;
}

/** Fail-closed release evidence collector. A retry can add diagnosis, never a pass. */
export class DeterministicFaultCampaign {
  readonly #observations: FaultObservation[] = [];

  constructor(readonly build: string) {
    if (!build.trim()) {
      throw new Error("campaign-build-required");
    }
  }

  record(observation: FaultObservation): void {
    if (!observation.id.trim()) {
      throw new Error("observation-id-required");
    }
    if ((observation.attempt ?? 1) < 1) {
      throw new Error("invalid-attempt");
    }

    validateShape(observation);
    const storedObservation = Object.freeze({
      ...observation,
      invariants: { ...observation.invariants },
    });
    this.#observations.push(storedObservation);
  }

  evaluate(): FaultCampaignEvidence {
    const authoritativeObservations = selectAuthoritativeObservations(
      this.#observations,
    );
    const missing = [...requiredKeys()].filter(
      key => !authoritativeObservations.has(key),
    );
    const failures: string[] = [];

    for (const [key, observation] of authoritativeObservations) {
      if (!observation.deterministic) {
        failures.push(`${key}:non-deterministic`);
      }
      if (!observation.passed) {
        failures.push(`${key}:failed`);
      }
      for (const invariant of CAMPAIGN_INVARIANTS) {
        if (observation.invariants[invariant] !== true) {
          failures.push(`${key}:${invariant}`);
        }
      }
    }

    return {
      schema: "pidex-fault-campaign-v1",
      build: this.build,
      observations: [...this.#observations],
      missing,
      failures,
      passed: missing.length === 0 && failures.length === 0,
    };
  }
}

function selectAuthoritativeObservations(
  observations: readonly FaultObservation[],
): Map<string, FaultObservation> {
  const authoritative = new Map<string, FaultObservation>();

  for (const observation of observations) {
    const key = observationKey(observation);
    const current = authoritative.get(key);
    if (!current || shouldReplace(current, observation)) {
      authoritative.set(key, observation);
    }
  }

  return authoritative;
}

function shouldReplace(
  current: FaultObservation,
  candidate: FaultObservation,
): boolean {
  const currentAttempt = current.attempt ?? 1;
  const candidateAttempt = candidate.attempt ?? 1;
  return (
    candidateAttempt < currentAttempt ||
    (candidateAttempt === currentAttempt && observationFailed(candidate))
  );
}

function observationFailed(value: FaultObservation): boolean {
  return (
    !value.passed ||
    !value.deterministic ||
    CAMPAIGN_INVARIANTS.some(name => value.invariants[name] !== true)
  );
}

export function requiredFaultCampaignKeys(): string[] {
  return [...requiredKeys()];
}

function requiredKeys(): Set<string> {
  const keys = new Set<string>();

  for (const boundary of FAULT_BOUNDARIES) {
    for (const phase of FAULT_PHASES) {
      keys.add(`boundary:${boundary}:${phase}`);
    }
  }
  for (const scenarios of Object.values(FAULT_SCENARIOS)) {
    for (const scenario of scenarios) {
      keys.add(`scenario:${scenario}`);
    }
  }
  for (const recovery of RECOVERY_DRILLS) {
    keys.add(`recovery:${recovery}`);
  }

  return keys;
}

function observationKey(value: FaultObservation): string {
  if (value.kind === "boundary") {
    return `boundary:${value.boundary}:${value.phase}`;
  }
  if (value.kind === "scenario") {
    return `scenario:${value.scenario}`;
  }
  return `recovery:${value.recovery}`;
}

function validateShape(value: FaultObservation): void {
  if (
    value.kind === "boundary" &&
    (value.boundary === undefined ||
      value.phase === undefined ||
      !FAULT_BOUNDARIES.includes(value.boundary) ||
      !FAULT_PHASES.includes(value.phase))
  ) {
    throw new Error("invalid-boundary-observation");
  }
  if (
    value.kind === "scenario" &&
    (value.scenario === undefined ||
      !Object.values(FAULT_SCENARIOS).flat().includes(value.scenario))
  ) {
    throw new Error("invalid-scenario-observation");
  }
  if (
    value.kind === "recovery" &&
    (value.recovery === undefined ||
      !RECOVERY_DRILLS.includes(value.recovery))
  ) {
    throw new Error("invalid-recovery-observation");
  }
}
