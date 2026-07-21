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

test("elevated Windows VM evidence binds both exact lanes and always cleans each scenario", async () => {
  const calls: string[] = [];
  const scenario = (name: ElevatedWindowsVmScenario["name"]): ElevatedWindowsVmScenario => ({
    name,
    async run(context) {
      calls.push(`run:${context.lane.lane}:${name}`);
      return { artifactSha256: "a".repeat(64), passedChecks: requiredChecks[name] };
    },
    async cleanup(context) { calls.push(`cleanup:${context.lane.lane}:${name}`); },
  });
  const campaign = new ElevatedWindowsVmCampaign(candidate, [
    scenario("native-capabilities"),
    scenario("two-checkout-source-lifecycle"),
  ]);

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
    "run:secondary:native-capabilities", "cleanup:secondary:native-capabilities",
    "run:secondary:two-checkout-source-lifecycle", "cleanup:secondary:two-checkout-source-lifecycle",
  ]);
});

test("failed scenarios remain authoritative and cleanup failures make evidence incomplete", async () => {
  const campaign = new ElevatedWindowsVmCampaign(candidate, [
    {
      name: "native-capabilities",
      async run() { throw new Error("Job assignment failed"); },
      async cleanup() { throw new Error("handle remained open"); },
    },
    {
      name: "two-checkout-source-lifecycle",
      async run() { return { artifactSha256: "b".repeat(64), passedChecks: requiredChecks["two-checkout-source-lifecycle"] }; },
      async cleanup() {},
    },
  ]);
  const input = {
    vm: { os: "Windows 11" as const, architecture: "x64" as const, elevated: true, disposable: true },
    attemptedAt: "2026-07-21T12:00:00.000Z",
  };
  const failed = await campaign.run(input);
  const diagnosticRetry = await new ElevatedWindowsVmCampaign(candidate, [
    { name: "native-capabilities", async run() { return { artifactSha256: "c".repeat(64), passedChecks: requiredChecks["native-capabilities"] }; }, async cleanup() {} },
    { name: "two-checkout-source-lifecycle", async run() { return { artifactSha256: "d".repeat(64), passedChecks: requiredChecks["two-checkout-source-lifecycle"] }; }, async cleanup() {} },
  ]).run(input);
  const attempts = new FirstAttemptEvidence();

  attempts.record(failed);
  attempts.record(diagnosticRetry);

  assert.equal(failed.status, "incomplete");
  assert.match(failed.lanes[0]!.scenarios[0]!.failure!, /cleanup failed: handle remained open/);
  assert.equal(attempts.authoritative(candidate.candidate), failed);
});
