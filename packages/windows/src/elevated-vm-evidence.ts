export interface WindowsNativeCandidate {
  schemaVersion: 1;
  candidate: string;
  architecture: "x64";
  nodeLanes: readonly WindowsNodeLane[];
  identities: WindowsCandidateIdentities;
}

export interface WindowsCandidateIdentities {
  addonSha256: string;
  closureSha256: string;
  sbomSha256: string;
  piVersion: string;
  launcherSha256: string;
  schemaGeneration: number;
  toolchain: string;
  configSha256: string;
}

export interface ObservedWindowsLaneIdentity extends WindowsCandidateIdentities {
  nodeVersion: string;
  nodeApi: number;
}

export interface SecondarySoakObservation {
  readinessObservations: number;
  wakeObservations: number;
  durationMinutes: number;
  residentSessions: number;
  executingSessions: number;
  maxHostRssMiB: number;
  maxWorkerRssMiB: number;
  quiescentCpuPercent: number;
  readinessSeconds: number;
  sleepingWorkerReadinessSeconds: number;
  monotonicallyGrowingHandles: boolean;
}

export interface PrimaryHyperVCampaignObservation {
  persistenceStateOracle: "passed" | "failed" | "incomplete";
  deterministicFaultRecoveryCampaign: "passed" | "failed" | "incomplete";
  hardPowerOff: {
    status: "passed" | "failed" | "incomplete";
    advisory: true;
    attempt: number;
  };
}

export interface WindowsNodeLane {
  lane: "primary" | "secondary";
  version: string;
  nodeApi: number;
}

export interface ElevatedWindowsVmContext {
  readonly candidate: string;
  readonly lane: WindowsNodeLane;
  readonly vm: ElevatedWindowsVmIdentity;
}

export interface ElevatedWindowsVmIdentity {
  os: "Windows 11";
  architecture: "x64";
  elevated: boolean;
  disposable: boolean;
}

export const requiredChecks = {
  "native-capabilities": [
    "exact-closure-and-addon-load-rejection",
    "capability-drift-transitions-and-late-faults",
    "job-containment-and-breakaway-attacks",
    "local-pipe-authentication-and-attacks",
    "complete-handle-cleanup",
  ],
  "two-checkout-source-lifecycle": [
    "prepare-start-update-rollback",
    "unprepare-and-reprepare",
    "fixed-origin-collision-rejection",
    "unconditional-fixture-cleanup",
  ],
  "launcher-cli-maintenance-states": [
    "ready-state",
    "degraded-state",
    "stopped-state",
    "circuit-state",
    "recovery-only-state",
    "incompatible-state",
    "interrupted-operation-state",
    "update-state",
    "rollback-state",
    "stopped-only-key-repair-state",
    "every-launcher-cli-lifecycle-repair-update-backup-and-maintenance-family",
    "durable-receipts-and-conservative-reconciliation",
    "stable-exits-secret-channels-and-output-separation",
    "redacted-logs-diagnostics-and-support-artifacts",
  ],
  "secondary-readiness-and-soak": [
    "twenty-readiness-observations",
    "twenty-wake-observations",
    "thirty-minute-four-resident-two-executing-soak",
    "memory-cpu-readiness-and-handle-ceilings",
  ],
  "primary-hyperv-failure-campaign": [
    "fresh-prepare-start-and-exact-readiness",
    "five-retries-circuit-and-explicit-retry",
    "pre-acceptance-rollback-and-launcher-crash-teardown",
    "daemon-worker-ipc-addon-and-descendant-failures",
    "session-isolation-stop-heartbeat-and-conservative-settlement",
    "interaction-withdrawal-and-no-uncertain-replay",
    "drain-restart-force-and-maintenance-exclusivity",
    "shutdown-logoff-and-drain-deadlines",
    "network-port-firewall-mdns-and-certificate-transitions",
    "volume-and-durability-coverage-transitions",
    "local-control-failure-states",
    "source-update-and-lazy-pi-migration",
    "backup-restore-reidentify-and-corrupt-newest-recovery",
  ],
} as const;

type ScenarioName = keyof typeof requiredChecks;

interface ElevatedWindowsVmScenarioOutput {
  artifactSha256: string;
  passedChecks?: readonly string[];
  observedIdentity?: ObservedWindowsLaneIdentity;
  secondarySoak?: SecondarySoakObservation;
  primaryCampaign?: PrimaryHyperVCampaignObservation;
}

export interface ElevatedWindowsVmScenario {
  name: ScenarioName;
  run(context: ElevatedWindowsVmContext): Promise<ElevatedWindowsVmScenarioOutput>;
  cleanup(context: ElevatedWindowsVmContext): Promise<void>;
}

interface ScenarioPolicy {
  lane?: WindowsNodeLane["lane"];
  validate?(output: ElevatedWindowsVmScenarioOutput): void;
}

const scenarioPolicies: Record<ScenarioName, ScenarioPolicy> = {
  "native-capabilities": {},
  "two-checkout-source-lifecycle": {},
  "launcher-cli-maintenance-states": {},
  "secondary-readiness-and-soak": {
    lane: "secondary",
    validate(output) {
      assertSecondarySoak(output.secondarySoak);
    },
  },
  "primary-hyperv-failure-campaign": {
    lane: "primary",
    validate(output) {
      assertPrimaryCampaign(output.primaryCampaign);
    },
  },
};

type EvidenceStatus = "passed" | "failed" | "incomplete";

interface ScenarioEvidence {
  name: ElevatedWindowsVmScenario["name"];
  status: EvidenceStatus;
  artifactSha256?: string;
  failure?: string;
  hardPowerOff?: PrimaryHyperVCampaignObservation["hardPowerOff"];
}

interface LaneEvidence {
  lane: WindowsNodeLane["lane"];
  nodeVersion: string;
  nodeApi: number;
  identities: ObservedWindowsLaneIdentity;
  status: EvidenceStatus;
  scenarios: ScenarioEvidence[];
}

export interface ElevatedWindowsVmEvidence {
  schema: "pidex-runnable-host-validation-v1";
  candidate: string;
  attemptedAt: string;
  vm: ElevatedWindowsVmIdentity;
  status: EvidenceStatus;
  lanes: LaneEvidence[];
}

export class ElevatedWindowsVmCampaign {
  constructor(
    private readonly candidate: WindowsNativeCandidate,
    private readonly scenarios: readonly ElevatedWindowsVmScenario[],
  ) {
    validateCampaign(candidate, scenarios);
  }

  async run(input: { vm: ElevatedWindowsVmIdentity; attemptedAt: string }): Promise<ElevatedWindowsVmEvidence> {
    assertVm(input.vm);
    const lanes: LaneEvidence[] = [];
    for (const lane of this.candidate.nodeLanes) {
      const results: ScenarioEvidence[] = [];
      for (const scenario of this.scenarios) {
        const policy = scenarioPolicies[scenario.name];
        if (policy.lane && policy.lane !== lane.lane) continue;
        const context = { candidate: this.candidate.candidate, lane, vm: input.vm };
        let result: ScenarioEvidence;
        try {
          const output = await scenario.run(context);
          if (!/^[a-f0-9]{64}$/.test(output.artifactSha256)) throw new Error("scenario returned an invalid artifact digest");
          const missing = requiredChecks[scenario.name].filter(check => !output.passedChecks?.includes(check));
          // Compatibility for programmatic scenarios is intentionally absent: VM evidence
          // must enumerate every observable gate rather than report one aggregate success.
          if (missing.length > 0) throw new Error(`scenario missing required checks: ${missing.join(", ")}`);
          assertIdentity(output.observedIdentity, this.candidate.identities, lane);
          policy.validate?.(output);
          result = {
            name: scenario.name,
            status: "passed",
            artifactSha256: output.artifactSha256,
            ...(output.primaryCampaign ? { hardPowerOff: { ...output.primaryCampaign.hardPowerOff } } : {}),
          };
        } catch (error) {
          result = { name: scenario.name, status: "failed", failure: coarseFailure(error) };
        }
        try {
          await scenario.cleanup(context);
        } catch (error) {
          const cleanupFailure = `cleanup failed: ${coarseFailure(error)}`;
          const failure = result.failure ? `${result.failure}; ${cleanupFailure}` : cleanupFailure;
          result = { name: scenario.name, status: "incomplete", failure };
        }
        results.push(result);
      }
      lanes.push({
        lane: lane.lane,
        nodeVersion: lane.version,
        nodeApi: lane.nodeApi,
        identities: { ...this.candidate.identities, nodeVersion: lane.version, nodeApi: lane.nodeApi },
        status: combinedStatus(results.map(result => result.status)),
        scenarios: results,
      });
    }
    return {
      schema: "pidex-runnable-host-validation-v1",
      candidate: this.candidate.candidate,
      attemptedAt: new Date(input.attemptedAt).toISOString(),
      vm: input.vm,
      status: combinedStatus(lanes.map(lane => lane.status)),
      lanes,
    };
  }
}

export { FirstAttemptEvidence } from "./first-attempt-evidence.js";

function validateCampaign(candidate: WindowsNativeCandidate, scenarios: readonly ElevatedWindowsVmScenario[]): void {
  if (candidate.schemaVersion !== 1 || candidate.architecture !== "x64") throw new Error("unsupported Windows native candidate");
  const lanes = candidate.nodeLanes.map(lane => lane.lane);
  if (lanes.length !== 2 || lanes[0] !== "primary" || lanes[1] !== "secondary") throw new Error("campaign requires exact primary and secondary Node lanes");
  assertCandidateIdentities(candidate.identities);
  const names = scenarios.map(scenario => scenario.name);
  const requiredScenarios = Object.keys(requiredChecks) as ElevatedWindowsVmScenario["name"][];
  if (names.length !== requiredScenarios.length || requiredScenarios.some(name => !names.includes(name))) {
    throw new Error("campaign requires native capabilities, two-checkout source lifecycle, and launcher/CLI/maintenance state scenarios");
  }
}

function assertCandidateIdentities(identities: WindowsCandidateIdentities): void {
  for (const [name, value] of Object.entries(identities)) {
    if (name.endsWith("Sha256") && !/^[a-f0-9]{64}$/.test(String(value))) throw new Error(`candidate ${name} must be an exact SHA-256 digest`);
  }
  if (!identities.piVersion || !identities.toolchain || !Number.isInteger(identities.schemaGeneration)) {
    throw new Error("candidate requires exact Pi, schema, and toolchain identities");
  }
}

function assertIdentity(
  observed: ObservedWindowsLaneIdentity | undefined,
  expected: WindowsCandidateIdentities,
  lane: WindowsNodeLane,
): void {
  if (!observed) throw new Error("scenario missing exact lane identity observation");
  const labels: Record<keyof WindowsCandidateIdentities, string> = {
    addonSha256: "addon", closureSha256: "closure", sbomSha256: "SBOM", piVersion: "Pi",
    launcherSha256: "launcher", schemaGeneration: "schema", toolchain: "toolchain", configSha256: "config",
  };
  for (const key of Object.keys(labels) as (keyof WindowsCandidateIdentities)[]) {
    if (observed[key] !== expected[key]) throw new Error(`${labels[key]} identity mismatch`);
  }
  if (observed.nodeVersion !== lane.version) throw new Error("runtime identity mismatch");
  if (observed.nodeApi !== lane.nodeApi) throw new Error("Node-API identity mismatch");
}

function assertSecondarySoak(soak: SecondarySoakObservation | undefined): void {
  if (!soak) throw new Error("secondary lane missing readiness/wake soak observations");
  const failures = [
    soak.readinessObservations < 20 && "readiness observations<20",
    soak.wakeObservations < 20 && "wake observations<20",
    soak.durationMinutes < 30 && "duration<30m",
    soak.residentSessions !== 4 && "resident sessions!=4",
    soak.executingSessions !== 2 && "executing sessions!=2",
    soak.maxHostRssMiB > 300 && "Host RSS>300MiB",
    soak.maxWorkerRssMiB > 300 && "worker RSS>300MiB",
    soak.quiescentCpuPercent > 1 && "quiescent CPU>1%",
    soak.readinessSeconds > 15 && "readiness>15s",
    soak.sleepingWorkerReadinessSeconds > 5 && "wake readiness>5s",
    soak.monotonicallyGrowingHandles && "handles monotonically growing",
  ].filter((failure): failure is string => Boolean(failure));
  if (failures.length > 0) throw new Error(`secondary soak ceilings failed: ${failures.join(", ")}`);
}

function assertPrimaryCampaign(campaign: PrimaryHyperVCampaignObservation | undefined): void {
  if (!campaign) throw new Error("primary lane missing Hyper-V campaign observations");
  if (campaign.persistenceStateOracle !== "passed") {
    throw new Error("blocking persistence-state oracle did not pass");
  }
  if (campaign.deterministicFaultRecoveryCampaign !== "passed") {
    throw new Error("blocking deterministic fault/recovery campaign did not pass");
  }
  if (campaign.hardPowerOff.advisory !== true || campaign.hardPowerOff.attempt !== 1) {
    throw new Error("hard-power-off evidence must preserve first-attempt advisory evidence");
  }
}

function assertVm(vm: ElevatedWindowsVmIdentity): void {
  if (vm.os !== "Windows 11" || vm.architecture !== "x64" || !vm.elevated || !vm.disposable) {
    throw new Error("evidence requires a disposable elevated Windows 11 x64 VM");
  }
}

function combinedStatus(statuses: readonly EvidenceStatus[]): EvidenceStatus {
  return statuses.includes("incomplete") ? "incomplete" : statuses.includes("failed") ? "failed" : "passed";
}

function coarseFailure(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "scenario failed";
}
