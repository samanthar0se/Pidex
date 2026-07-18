import assert from "node:assert/strict";
import test from "node:test";
import {
  LATENCY_BUDGETS_MS,
  PerformanceGate,
  RESOURCE_BUDGETS,
} from "../packages/host/src/performance-budgets.js";

test("performance evidence gates p95 local work without charging external waits", () => {
  const gate = new PerformanceGate({
    build: "sha256:release",
    environment: {
      os: "Windows 11",
      browser: "Edge 128",
      memoryBytes: 8 * 1024 ** 3,
    },
    network: { rttMs: 50, lossPercent: 1 },
  });

  for (let index = 0; index < 20; index += 1) {
    gate.recordLatency("hostCommandOutcome", {
      localMs: index >= 18 ? 250 : 120,
      external: { providerMs: 10_000 },
    });
  }
  gate.assertAuthority("accepted-command-has-one-outcome", true);

  const evidence = gate.evaluate();
  assert.equal(LATENCY_BUDGETS_MS.hostCommandOutcome, 250);
  assert.equal(evidence.latency.hostCommandOutcome?.p95LocalMs, 250);
  assert.equal(evidence.latency.hostCommandOutcome?.external.providerMs, 200_000);
  assert.equal(evidence.passed, true);
});

test("resource and soak gates enforce quiescent bounds and leak detection", () => {
  const gate = new PerformanceGate({
    build: "sha256:release",
    environment: {
      os: "Windows 11",
      browser: "Chrome 128",
      memoryBytes: 16 * 1024 ** 3,
    },
    network: { rttMs: 40, lossPercent: 0.5 },
  });
  gate.recordQuiescent({
    launcherDaemonRssBytes: 299 * 1024 ** 2,
    launcherDaemonCpuPercent: 0.9,
    workerRssBytes: [300 * 1024 ** 2],
  });
  gate.recordClient({
    timelineEntries: 100_000,
    heapBytes: 299 * 1024 ** 2,
    longestNavigationTaskMs: 40,
  });
  gate.recordSoak({
    beforeRssBytes: 200,
    afterRssBytes: 220,
    handleSamples: [20, 22, 21],
    diagnosticBytes: RESOURCE_BUDGETS.diagnosticBytes,
  });
  gate.assertAuthority("timeline-remains-authoritative", true);
  assert.equal(gate.evaluate().passed, true);

  gate.recordSoak({
    beforeRssBytes: 200,
    afterRssBytes: 221,
    handleSamples: [20, 21, 22],
    diagnosticBytes: 1,
  });
  const failed = gate.evaluate();
  assert.equal(failed.passed, false);
  assert.ok(failed.failures.includes("soak-memory-growth>10%"));
  assert.ok(failed.failures.includes("soak-handles-monotonic"));
});
