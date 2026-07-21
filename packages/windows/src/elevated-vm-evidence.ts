export interface WindowsNativeCandidate {
  schemaVersion: 1;
  candidate: string;
  architecture: "x64";
  nodeLanes: readonly WindowsNodeLane[];
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

export interface ElevatedWindowsVmScenario {
  name: "native-capabilities" | "two-checkout-source-lifecycle";
  run(context: ElevatedWindowsVmContext): Promise<{
    artifactSha256: string;
    passedChecks?: readonly string[];
  }>;
  cleanup(context: ElevatedWindowsVmContext): Promise<void>;
}

type EvidenceStatus = "passed" | "failed" | "incomplete";

interface ScenarioEvidence {
  name: ElevatedWindowsVmScenario["name"];
  status: EvidenceStatus;
  artifactSha256?: string;
  failure?: string;
}

interface LaneEvidence {
  lane: WindowsNodeLane["lane"];
  nodeVersion: string;
  nodeApi: number;
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
        const context = { candidate: this.candidate.candidate, lane, vm: input.vm };
        let result: ScenarioEvidence;
        try {
          const output = await scenario.run(context);
          if (!/^[a-f0-9]{64}$/.test(output.artifactSha256)) throw new Error("scenario returned an invalid artifact digest");
          const missing = requiredChecks[scenario.name].filter(check => !output.passedChecks?.includes(check));
          // Compatibility for programmatic scenarios is intentionally absent: VM evidence
          // must enumerate every observable gate rather than report one aggregate success.
          if (missing.length > 0) throw new Error(`scenario missing required checks: ${missing.join(", ")}`);
          result = { name: scenario.name, status: "passed", artifactSha256: output.artifactSha256 };
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
} as const satisfies Record<ElevatedWindowsVmScenario["name"], readonly string[]>;

export { FirstAttemptEvidence } from "./first-attempt-evidence.js";

function validateCampaign(candidate: WindowsNativeCandidate, scenarios: readonly ElevatedWindowsVmScenario[]): void {
  if (candidate.schemaVersion !== 1 || candidate.architecture !== "x64") throw new Error("unsupported Windows native candidate");
  const lanes = candidate.nodeLanes.map(lane => lane.lane);
  if (lanes.length !== 2 || lanes[0] !== "primary" || lanes[1] !== "secondary") throw new Error("campaign requires exact primary and secondary Node lanes");
  const names = scenarios.map(scenario => scenario.name);
  if (names.length !== 2 || !names.includes("native-capabilities") || !names.includes("two-checkout-source-lifecycle")) {
    throw new Error("campaign requires native capabilities and two-checkout source lifecycle scenarios");
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
