import assert from "node:assert/strict";
import test from "node:test";
import {
  ElevatedWindowsVmCampaign,
  FirstAttemptEvidence,
  requiredChecks,
  type ElevatedWindowsVmScenario,
} from "../packages/windows/src/elevated-vm-evidence.js";

const candidate = {
  schemaVersion: 1 as const,
  candidate: "windows-native-2026-07-21",
  architecture: "x64" as const,
  nodeLanes: [
    { lane: "primary" as const, version: "24.18.0", nodeApi: 10 },
    { lane: "secondary" as const, version: "22.23.1", nodeApi: 10 },
  ],
};

function passingScenario(
  name: ElevatedWindowsVmScenario["name"],
  artifactSha256: string,
  recordCall: (call: string) => void = () => {},
): ElevatedWindowsVmScenario {
  return {
    name,
    async run(context) {
      recordCall(`run:${context.lane.lane}:${name}`);
      return { artifactSha256, passedChecks: requiredChecks[name] };
    },
    async cleanup(context) {
      recordCall(`cleanup:${context.lane.lane}:${name}`);
    },
  };
}

type ScenarioName = ElevatedWindowsVmScenario["name"];

interface CompleteScenarioSetOptions {
  artifactSha256: string | Record<ScenarioName, string>;
  overrides?: Partial<Record<ScenarioName, ElevatedWindowsVmScenario>>;
  recordCall?: (call: string) => void;
}

function completeScenarioSet({
  artifactSha256,
  overrides = {},
  recordCall,
}: CompleteScenarioSetOptions): ElevatedWindowsVmScenario[] {
  const scenarioNames = Object.keys(requiredChecks) as ScenarioName[];
  return scenarioNames.map(name => {
    const digest = typeof artifactSha256 === "string" ? artifactSha256 : artifactSha256[name];
    return overrides[name] ?? passingScenario(name, digest, recordCall);
  });
}

test("elevated Windows VM evidence binds both exact lanes and always cleans each scenario", async () => {
  const calls: string[] = [];
  const recordCall = (call: string): void => {
    calls.push(call);
  };
  const campaign = new ElevatedWindowsVmCampaign(candidate, completeScenarioSet({
    artifactSha256: "a".repeat(64),
    recordCall,
  }));

  const evidence = await campaign.run({
    vm: { os: "Windows 11", architecture: "x64", elevated: true, disposable: true },
    attemptedAt: "2026-07-21T12:00:00.000Z",
  });

  assert.equal(evidence.schema, "pidex-runnable-host-validation-v1");
  assert.equal(evidence.candidate, candidate.candidate);
  assert.equal(evidence.status, "passed");
  assert.deepEqual(evidence.lanes.map(lane => [lane.lane, lane.nodeVersion, lane.status]), [
    ["primary", "24.18.0", "passed"],
    ["secondary", "22.23.1", "passed"],
  ]);
  assert.deepEqual(calls, [
    "run:primary:native-capabilities", "cleanup:primary:native-capabilities",
    "run:primary:two-checkout-source-lifecycle", "cleanup:primary:two-checkout-source-lifecycle",
    "run:primary:launcher-cli-maintenance-states", "cleanup:primary:launcher-cli-maintenance-states",
    "run:secondary:native-capabilities", "cleanup:secondary:native-capabilities",
    "run:secondary:two-checkout-source-lifecycle", "cleanup:secondary:two-checkout-source-lifecycle",
    "run:secondary:launcher-cli-maintenance-states", "cleanup:secondary:launcher-cli-maintenance-states",
  ]);
});

test("failed scenarios remain authoritative and cleanup failures make evidence incomplete", async () => {
  const campaign = new ElevatedWindowsVmCampaign(candidate, completeScenarioSet({
    artifactSha256: "b".repeat(64),
    overrides: {
      "native-capabilities": {
        name: "native-capabilities",
        async run() { throw new Error("Job assignment failed"); },
        async cleanup() { throw new Error("handle remained open"); },
      },
    },
  }));
  const input = {
    vm: { os: "Windows 11" as const, architecture: "x64" as const, elevated: true, disposable: true },
    attemptedAt: "2026-07-21T12:00:00.000Z",
  };
  const failed = await campaign.run(input);
  const diagnosticRetry = await new ElevatedWindowsVmCampaign(candidate, completeScenarioSet({
    artifactSha256: {
      "native-capabilities": "c".repeat(64),
      "two-checkout-source-lifecycle": "d".repeat(64),
      "launcher-cli-maintenance-states": "e".repeat(64),
    },
  })).run(input);
  const attempts = new FirstAttemptEvidence();

  attempts.record(failed);
  attempts.record(diagnosticRetry);

  assert.equal(failed.status, "incomplete");
  assert.equal(
    failed.lanes[0]!.scenarios[0]!.failure,
    "Job assignment failed; cleanup failed: handle remained open",
  );
  assert.equal(attempts.authoritative(candidate.candidate), failed);
});

test("launcher, CLI, and maintenance evidence requires every supported Host state and contract", async () => {
  const campaign = new ElevatedWindowsVmCampaign(candidate, completeScenarioSet({
    artifactSha256: {
      "native-capabilities": "a".repeat(64),
      "two-checkout-source-lifecycle": "b".repeat(64),
      "launcher-cli-maintenance-states": "c".repeat(64),
    },
    overrides: {
      "launcher-cli-maintenance-states": {
        name: "launcher-cli-maintenance-states",
        async run() {
          return {
            artifactSha256: "c".repeat(64),
            passedChecks: requiredChecks["launcher-cli-maintenance-states"].filter(
              check => check !== "durable-receipts-and-conservative-reconciliation",
            ),
          };
        },
        async cleanup() {},
      },
    },
  }));

  const evidence = await campaign.run({
    vm: { os: "Windows 11", architecture: "x64", elevated: true, disposable: true },
    attemptedAt: "2026-07-21T12:00:00.000Z",
  });

  assert.equal(evidence.status, "failed");
  assert.match(
    evidence.lanes[0]!.scenarios[2]!.failure ?? "",
    /durable-receipts-and-conservative-reconciliation/,
  );
});
