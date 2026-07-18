import assert from "node:assert/strict";
import test from "node:test";
import {
  assessBrowser,
  REQUIRED_BROWSER_MATRIX,
} from "../apps/pwa/browser-compatibility.mjs";
import {
  HostCapacityAdmission,
  capacityFixture,
} from "../packages/host/src/capacity-admission.js";

const semantics = {
  secureContext: true,
  webSocket: true,
  indexedDb: true,
  serviceWorker: true,
  subtleCrypto: true,
  randomUuid: true,
};

test("required browser modes pass only with the complete authority semantics", () => {
  assert.deepEqual(REQUIRED_BROWSER_MATRIX.map(entry => entry.mode), [
    "windows-edge", "windows-chrome", "android-chrome",
    "ios-safari", "ios-standalone", "ipados-safari", "ipados-standalone",
  ]);
  for (const entry of REQUIRED_BROWSER_MATRIX) {
    assert.equal(assessBrowser(entry.exampleUserAgent, semantics, entry.standalone).supported, true);
  }
  assert.deepEqual(
    assessBrowser("Mozilla/5.0 Firefox/128.0", semantics, false),
    { supported: false, reason: "unsupported-browser" },
  );
  assert.equal(
    assessBrowser(REQUIRED_BROWSER_MATRIX[0]!.exampleUserAgent, {
      ...semantics,
      indexedDb: false,
    }, false).reason,
    "missing-required-semantics:indexedDb",
  );
});

test("capacity tiers use measured headroom and retain the scale fixture without caps", () => {
  assert.deepEqual(capacityFixture, {
    retainedSessions: 10_000,
    timelineEntries: 100_000,
    clients: 6,
    devices: 3,
  });
  const eight = new HostCapacityAdmission({ totalMemoryBytes: 8 * 1024 ** 3 });
  assert.deepEqual(eight.floor, { residentSessions: 4, executingRuns: 2 });
  assert.equal(eight.assess({ residentSessions: 3, executingRuns: 1, availableMemoryBytes: 3 * 1024 ** 3 }).admitted, true);
  assert.match(eight.assess({ residentSessions: 4, executingRuns: 2, availableMemoryBytes: 900 * 1024 ** 2 }).reason!, /memory-pressure/);

  const sixteen = new HostCapacityAdmission({ totalMemoryBytes: 16 * 1024 ** 3 });
  assert.deepEqual(sixteen.floor, { residentSessions: 8, executingRuns: 4 });
  assert.equal(sixteen.assess({ residentSessions: 8, executingRuns: 4, availableMemoryBytes: 8 * 1024 ** 3 }).admitted, true);
  assert.equal(sixteen.retainedSessionLimit, undefined);
});
