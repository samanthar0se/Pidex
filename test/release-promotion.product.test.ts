import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_DRIVER_OPERATIONS,
  PROMOTION_GATES,
  ReleasePromotion,
  SOAK_CAPACITY_TIERS,
  type DailyDriverResult,
  type SoakResult,
} from "../packages/host/src/release-promotion.js";

const trace = {
  build: "sha256:release",
  environment: "Windows 11 24H2 / x64 / 16GiB",
  configuration: "release.json#sha256:config",
  artifacts: ["trace.json#sha256:trace"],
};

type SoakTier = (typeof SOAK_CAPACITY_TIERS)[number];

function passingSoak(tier: SoakTier): SoakResult {
  return {
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
  };
}

function dailyDriverOperations(
  operationCount = 2,
  settledStopCount = operationCount,
): DailyDriverResult["operations"] {
  return Object.fromEntries(
    DAILY_DRIVER_OPERATIONS.map(operation => [
      operation,
      {
        accepted: operationCount,
        settled: operation === "stop" ? settledStopCount : operationCount,
        unique: operationCount,
      },
    ]),
  );
}

function passingDailyDriver(): DailyDriverResult {
  return {
    ...trace,
    durationDays: 7,
    desktopUsed: true,
    mobileUsed: true,
    otherPiUiCoreActions: 0,
    operations: dailyDriverOperations(),
  };
}

function passingPromotion(): ReleasePromotion {
  const promotion = new ReleasePromotion("sha256:release");
  for (const tier of SOAK_CAPACITY_TIERS) {
    promotion.recordSoak(passingSoak(tier));
  }
  promotion.recordDailyDriver(passingDailyDriver());
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
    ...passingSoak("8-gib"),
    durationHours: 71,
    invariantViolations: 1,
    memoryGrowthPercent: 11,
    handleSamples: [1, 2, 3],
    diagnosticBytes: 1,
  });
  promotion.recordDailyDriver({
    ...passingDailyDriver(),
    operations: dailyDriverOperations(1, 0),
  });
  const evidence = promotion.evaluate();
  assert.equal(evidence.passed, false);
  assert.ok(evidence.failures.includes("soak:8-gib:duration<72h"));
  assert.ok(evidence.failures.includes("soak:8-gib:handles-monotonic"));
  assert.ok(evidence.failures.includes("daily-driver:stop:lost-or-outcome-less"));
});

test("successful reruns cannot erase failed evidence for the same build", () => {
  const promotion = passingPromotion();

  promotion.recordSoak({ ...passingSoak("8-gib"), durationHours: 71 });
  promotion.recordDailyDriver({ ...passingDailyDriver(), durationDays: 6 });
  promotion.recordGate({ ...trace, gate: "pi-contracts", passed: false });

  promotion.recordSoak(passingSoak("8-gib"));
  promotion.recordDailyDriver(passingDailyDriver());
  promotion.recordGate({ ...trace, gate: "pi-contracts", passed: true });

  const evidence = promotion.evaluate();
  assert.equal(evidence.passed, false);
  assert.ok(evidence.failures.includes("soak:8-gib:duration<72h"));
  assert.ok(evidence.failures.includes("daily-driver:duration<7d"));
  assert.ok(evidence.failures.includes("gate:pi-contracts:failed"));
});
