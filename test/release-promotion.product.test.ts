import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_DRIVER_OPERATIONS,
  PROMOTION_GATES,
  ReleasePromotion,
  SOAK_CAPACITY_TIERS,
} from "../packages/host/src/release-promotion.js";

const trace = {
  build: "sha256:release",
  environment: "Windows 11 24H2 / x64 / 16GiB",
  configuration: "release.json#sha256:config",
  artifacts: ["trace.json#sha256:trace"],
};

function passingPromotion(): ReleasePromotion {
  const promotion = new ReleasePromotion("sha256:release");
  for (const tier of SOAK_CAPACITY_TIERS) {
    promotion.recordSoak({
      ...trace,
      tier,
      durationHours: 72,
      invariantViolations: 0,
      daemonCrashes: 0,
      stuckAcceptedWork: 0,
      convergenceFailures: 0,
      unboundedQueueGrowth: false,
      resourceLimitFailures: 0,
      equivalentQuiescence: true,
      memoryGrowthPercent: 10,
      handleSamples: [100, 102, 101],
      diagnosticBytes: 1024,
    });
  }
  promotion.recordDailyDriver({
    ...trace,
    durationDays: 7,
    desktopUsed: true,
    mobileUsed: true,
    otherPiUiCoreActions: 0,
    operations: Object.fromEntries(
      DAILY_DRIVER_OPERATIONS.map(operation => [
        operation,
        { accepted: 2, settled: 2, unique: 2 },
      ]),
    ),
  });
  for (const gate of PROMOTION_GATES) {
    promotion.recordGate({ ...trace, gate, passed: true });
  }
  promotion.recordBoundaries({
    accessibility: "No WCAG conformance claim; workflow regressions still block.",
    observability: "Typed local diagnostics only; no telemetry claim.",
    wcagClaimed: false,
    telemetryClaimed: false,
    penetrationTestClaimed: false,
    workerSandboxClaimed: false,
  });
  return promotion;
}

test("complete traced soak, daily-driver, and promotion evidence permits release", () => {
  const evidence = passingPromotion().evaluate();
  assert.equal(evidence.passed, true);
  assert.deepEqual(evidence.missing, []);
});

test("hard failures, defects, invalid waivers, and stale impacted evidence block", () => {
  const promotion = passingPromotion();
  promotion.recordGate({ ...trace, gate: "pi-contracts", passed: false });
  promotion.recordDefect({ id: "BUG-1", severity: 2, status: "open" });
  promotion.recordDefect({ id: "BUG-3", severity: 3, status: "open" });
  promotion.recordWaiver({
    id: "W-1",
    externalDefect: "Safari OS defect",
    safeFallback: "Use Edge",
    guaranteesPreserved: false,
  });
  promotion.recordImpact({
    change: "dependency update",
    affectedGates: ["security-automation"],
    rerunGates: [],
  });

  const evidence = promotion.evaluate();
  assert.equal(evidence.passed, false);
  assert.ok(evidence.failures.includes("gate:pi-contracts:failed"));
  assert.ok(evidence.failures.includes("defect:BUG-1:severity-2"));
  assert.ok(evidence.failures.includes("defect:BUG-3:severity-3-incomplete"));
  assert.ok(evidence.failures.includes("waiver:W-1:weakens-guarantee"));
  assert.ok(evidence.failures.includes("impact:dependency update:security-automation-not-rerun"));
});

test("soak and daily-driver evidence fails closed on resource and operation loss", () => {
  const promotion = passingPromotion();
  promotion.recordSoak({
    ...trace,
    tier: "8-gib",
    durationHours: 71,
    invariantViolations: 1,
    daemonCrashes: 0,
    stuckAcceptedWork: 0,
    convergenceFailures: 0,
    unboundedQueueGrowth: false,
    resourceLimitFailures: 0,
    equivalentQuiescence: true,
    memoryGrowthPercent: 11,
    handleSamples: [1, 2, 3],
    diagnosticBytes: 1,
  });
  promotion.recordDailyDriver({
    ...trace,
    durationDays: 7,
    desktopUsed: true,
    mobileUsed: true,
    otherPiUiCoreActions: 0,
    operations: Object.fromEntries(
      DAILY_DRIVER_OPERATIONS.map(operation => [
        operation,
        { accepted: 1, settled: operation === "stop" ? 0 : 1, unique: 1 },
      ]),
    ),
  });
  const evidence = promotion.evaluate();
  assert.equal(evidence.passed, false);
  assert.ok(evidence.failures.includes("soak:8-gib:duration<72h"));
  assert.ok(evidence.failures.includes("soak:8-gib:handles-monotonic"));
  assert.ok(evidence.failures.includes("daily-driver:stop:lost-or-outcome-less"));
});
