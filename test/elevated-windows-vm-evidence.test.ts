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
  identities: {
    addonSha256: "1".repeat(64), closureSha256: "2".repeat(64), sbomSha256: "3".repeat(64),
    piVersion: "0.80.10", launcherSha256: "4".repeat(64), schemaGeneration: 1,
    toolchain: "msvc-19.44.35207-sdk-10.0.26100.0-cmake-4.3.3-cpp20", configSha256: "5".repeat(64),
  },
};

const passingSecondarySoak = {
  readinessObservations: 20,
  wakeObservations: 20,
  durationMinutes: 30,
  residentSessions: 4,
  executingSessions: 2,
  maxHostRssMiB: 300,
  maxWorkerRssMiB: 300,
  quiescentCpuPercent: 1,
  readinessSeconds: 15,
  sleepingWorkerReadinessSeconds: 5,
  monotonicallyGrowingHandles: false,
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
      return {
        artifactSha256,
        passedChecks: requiredChecks[name],
        observedIdentity: { ...candidate.identities, nodeVersion: context.lane.version, nodeApi: context.lane.nodeApi },
        secondarySoak: passingSecondarySoak,
        primaryCampaign: {
          persistenceStateOracle: "passed",
          deterministicFaultRecoveryCampaign: "passed",
          hardPowerOff: { status: "failed", advisory: true, attempt: 1 },
        },
      };
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
    "run:primary:primary-hyperv-failure-campaign", "cleanup:primary:primary-hyperv-failure-campaign",
    "run:secondary:native-capabilities", "cleanup:secondary:native-capabilities",
    "run:secondary:two-checkout-source-lifecycle", "cleanup:secondary:two-checkout-source-lifecycle",
    "run:secondary:launcher-cli-maintenance-states", "cleanup:secondary:launcher-cli-maintenance-states",
    "run:secondary:secondary-readiness-and-soak", "cleanup:secondary:secondary-readiness-and-soak",
  ]);
  assert.equal(evidence.lanes[0]!.identities.configSha256, candidate.identities.configSha256);
  assert.equal(evidence.lanes[1]!.identities.nodeVersion, "22.23.1");
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
      "secondary-readiness-and-soak": "f".repeat(64),
      "primary-hyperv-failure-campaign": "1".repeat(64),
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
  assert.throws(
    () => attempts.requirePassing(candidate.candidate),
    /authoritative first attempt did not pass/,
  );
});

test("the two-lane gate returns only a passing authoritative first attempt", async () => {
  const passing = await new ElevatedWindowsVmCampaign(candidate, completeScenarioSet({
    artifactSha256: "a".repeat(64),
  })).run({
    vm: { os: "Windows 11", architecture: "x64", elevated: true, disposable: true },
    attemptedAt: "2026-07-21T12:00:00.000Z",
  });
  const attempts = new FirstAttemptEvidence();

  assert.throws(
    () => attempts.requirePassing(candidate.candidate),
    /authoritative first attempt is missing/,
  );
  attempts.record(passing);
  assert.equal(attempts.requirePassing(candidate.candidate), passing);
});

test("launcher, CLI, and maintenance evidence requires every supported Host state and contract", async () => {
  const campaign = new ElevatedWindowsVmCampaign(candidate, completeScenarioSet({
    artifactSha256: {
      "native-capabilities": "a".repeat(64),
      "two-checkout-source-lifecycle": "b".repeat(64),
      "launcher-cli-maintenance-states": "c".repeat(64),
      "secondary-readiness-and-soak": "d".repeat(64),
      "primary-hyperv-failure-campaign": "e".repeat(64),
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

test("secondary evidence fails closed on identity drift and an undersized readiness soak", async () => {
  const campaign = new ElevatedWindowsVmCampaign(candidate, completeScenarioSet({
    artifactSha256: "d".repeat(64),
    overrides: {
      "secondary-readiness-and-soak": {
        name: "secondary-readiness-and-soak",
        async run(context) {
          return {
            artifactSha256: "d".repeat(64), passedChecks: requiredChecks["secondary-readiness-and-soak"],
            observedIdentity: { ...candidate.identities, nodeVersion: context.lane.version, nodeApi: context.lane.nodeApi, configSha256: "6".repeat(64) },
            secondarySoak: {
              readinessObservations: 19, wakeObservations: 20, durationMinutes: 29,
              residentSessions: 4, executingSessions: 2, maxHostRssMiB: 301,
              maxWorkerRssMiB: 300, quiescentCpuPercent: 1, readinessSeconds: 15,
              sleepingWorkerReadinessSeconds: 5, monotonicallyGrowingHandles: false,
            },
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
  assert.match(evidence.lanes[1]!.scenarios.at(-1)!.failure ?? "", /config identity mismatch/);
});
