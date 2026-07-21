import assert from "node:assert/strict";
import test from "node:test";
import {
  ElevatedWindowsVmCampaign,
  requiredChecks,
  type ElevatedWindowsVmScenario,
} from "../packages/windows/src/elevated-vm-evidence.js";

const candidate = {
  schemaVersion: 1 as const,
  candidate: "primary-hyperv-candidate",
  architecture: "x64" as const,
  nodeLanes: [
    { lane: "primary" as const, version: "24.18.0", nodeApi: 10 },
    { lane: "secondary" as const, version: "22.23.1", nodeApi: 10 },
  ],
  identities: {
    addonSha256: "1".repeat(64), closureSha256: "2".repeat(64), sbomSha256: "3".repeat(64),
    piVersion: "0.80.10", launcherSha256: "4".repeat(64), schemaGeneration: 1,
    toolchain: "pinned-msvc", configSha256: "5".repeat(64),
  },
};

function scenarios(persistenceStateOracle: "passed" | "failed", hardPowerOff: "passed" | "failed"): ElevatedWindowsVmScenario[] {
  return (Object.keys(requiredChecks) as ElevatedWindowsVmScenario["name"][]).map(name => ({
    name,
    async run(context) {
      return {
        artifactSha256: "a".repeat(64),
        passedChecks: requiredChecks[name],
        observedIdentity: { ...candidate.identities, nodeVersion: context.lane.version, nodeApi: context.lane.nodeApi },
        secondarySoak: {
          readinessObservations: 20, wakeObservations: 20, durationMinutes: 30,
          residentSessions: 4, executingSessions: 2, maxHostRssMiB: 300,
          maxWorkerRssMiB: 300, quiescentCpuPercent: 1, readinessSeconds: 15,
          sleepingWorkerReadinessSeconds: 5, monotonicallyGrowingHandles: false,
        },
        primaryCampaign: {
          persistenceStateOracle,
          deterministicFaultRecoveryCampaign: "passed" as const,
          hardPowerOff: { status: hardPowerOff, advisory: true as const, attempt: 1 },
        },
      };
    },
    async cleanup() {},
  }));
}

const input = {
  vm: { os: "Windows 11" as const, architecture: "x64" as const, elevated: true, disposable: true },
  attemptedAt: "2026-07-21T12:00:00.000Z",
};

test("primary Hyper-V campaign blocks persistence failures while hard-power-off remains advisory", async () => {
  const failed = await new ElevatedWindowsVmCampaign(candidate, scenarios("failed", "passed")).run(input);
  assert.equal(failed.status, "failed");
  assert.match(failed.lanes[0]!.scenarios.at(-1)!.failure ?? "", /persistence-state oracle/);

  const advisoryFailure = await new ElevatedWindowsVmCampaign(candidate, scenarios("passed", "failed")).run(input);
  assert.equal(advisoryFailure.status, "passed");
  assert.equal(advisoryFailure.lanes[0]!.scenarios.at(-1)!.hardPowerOff?.status, "failed");
  assert.equal(advisoryFailure.lanes[0]!.scenarios.at(-1)!.hardPowerOff?.advisory, true);
});
