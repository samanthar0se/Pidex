import assert from "node:assert/strict";
import test from "node:test";
import {
  HyperVCampaignController,
  ReleaseDurabilityEvidence,
  type HyperVCampaignAttempt,
} from "../packages/durability/src/hyperv-evidence.js";

const attempt = (result: HyperVCampaignAttempt["result"]): HyperVCampaignAttempt => ({
  schema: "pidex-hyperv-attempt-v1",
  campaignId: "periodic-2026-07",
  build: "sha256:release",
  kind: "periodic",
  attemptedAt: 100,
  result,
  recovery: result === "passed" ? "selected" : "fail-closed",
  reconciliation: result === "incomplete" ? "not-completed" : "completed",
});

test("campaign arms out of band, powers off externally, captures before production recovery", async () => {
  const calls: string[] = [];
  const controller = new HyperVCampaignController({
    arm: async record => { calls.push(`arm:${record.campaignId}`); },
    hardPowerOff: async () => { calls.push("external-power-off"); },
    capturePreRecovery: async () => { calls.push("capture-pre-start"); return { boot: 4 }; },
    recoverProduction: async () => { calls.push("production-resolver-and-reconciliation"); return "selected"; },
  });

  const evidence = await controller.run({
    campaignId: "periodic-2026-07", build: "sha256:release", kind: "periodic", now: 100,
  });

  assert.deepEqual(calls, [
    "arm:periodic-2026-07", "external-power-off", "capture-pre-start",
    "production-resolver-and-reconciliation",
  ]);
  assert.equal(evidence.result, "passed");
  assert.equal("guestName" in evidence, false);
  assert.deepEqual(evidence.preRecovery, { boot: 4 });
});

test("release artifacts preserve first attempts and report model and advisory VM state honestly", () => {
  const release = new ReleaseDurabilityEvidence("sha256:release", 200, 50);
  release.recordModel({ attemptedAt: 190, result: "passed", complete: true });
  release.recordHyperV(attempt("failed"));
  release.recordHyperV(attempt("passed")); // diagnostic retry cannot turn evidence green

  const artifact = release.publish();
  assert.equal(artifact.deterministicModel.status, "passed");
  assert.equal(artifact.hyperV.status, "failed");
  assert.equal(artifact.hyperV.advisory, true);
  assert.equal(artifact.promotionEligible, true);
  assert.match(artifact.claimBoundary, /not physical-media certification/i);

  assert.equal(new ReleaseDurabilityEvidence("sha256:release", 200, 50).publish().hyperV.status, "missing");
  const stale = new ReleaseDurabilityEvidence("sha256:release", 200, 50);
  stale.recordHyperV(attempt("passed"));
  assert.equal(stale.publish().hyperV.status, "stale");
  const incomplete = new ReleaseDurabilityEvidence("sha256:release", 120, 50);
  incomplete.recordHyperV({ ...attempt("passed"), reconciliation: "not-completed" });
  assert.equal(incomplete.publish().hyperV.status, "incomplete");
});
