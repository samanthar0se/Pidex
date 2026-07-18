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

const MEBIBYTE = 1024 ** 2;
const GIBIBYTE = 1024 ** 3;

const completeBrowserSemantics = {
  secureContext: true,
  webSocket: true,
  indexedDb: true,
  serviceWorker: true,
  subtleCrypto: true,
  randomUuid: true,
};

test("required browser modes pass only with the complete authority semantics", () => {
  assert.deepEqual(REQUIRED_BROWSER_MATRIX.map(entry => entry.mode), [
    "windows-edge",
    "windows-chrome",
    "android-chrome",
    "ios-safari",
    "ios-standalone",
    "ipados-safari",
    "ipados-standalone",
  ]);
  const [windowsEdge] = REQUIRED_BROWSER_MATRIX;
  assert.ok(windowsEdge);

  for (const entry of REQUIRED_BROWSER_MATRIX) {
    const assessment = assessBrowser(
      entry.exampleUserAgent,
      completeBrowserSemantics,
      entry.standalone,
    );
    assert.equal(assessment.supported, true);
  }

  assert.deepEqual(
    assessBrowser(
      "Mozilla/5.0 Firefox/128.0",
      completeBrowserSemantics,
      false,
    ),
    { supported: false, reason: "unsupported-browser" },
  );
  for (const semantic of Object.keys(completeBrowserSemantics)) {
    assert.equal(
      assessBrowser(
        windowsEdge.exampleUserAgent,
        { ...completeBrowserSemantics, [semantic]: false },
        false,
      ).reason,
      `missing-required-semantics:${semantic}`,
    );
  }
});

test("capacity tiers use measured headroom and retain the scale fixture without caps", () => {
  assert.deepEqual(capacityFixture, {
    retainedSessions: 10_000,
    timelineEntries: 100_000,
    clients: 6,
    devices: 3,
  });

  const eightGibibyteHost = new HostCapacityAdmission({
    totalMemoryBytes: 8 * GIBIBYTE,
  });
  assert.deepEqual(eightGibibyteHost.floor, {
    residentSessions: 4,
    executingRuns: 2,
  });
  assert.deepEqual(
    eightGibibyteHost.assess({
      residentSessions: 3,
      executingRuns: 1,
      availableMemoryBytes: 3 * GIBIBYTE,
    }),
    { admitted: true },
  );
  assert.deepEqual(
    eightGibibyteHost.assess({
      residentSessions: 4,
      executingRuns: 2,
      availableMemoryBytes: 900 * MEBIBYTE,
    }),
    {
      admitted: false,
      reason: `memory-pressure: ${900 * MEBIBYTE} bytes available; ${GIBIBYTE} OS headroom required`,
    },
  );

  const sixteenGibibyteHost = new HostCapacityAdmission({
    totalMemoryBytes: 16 * GIBIBYTE,
  });
  assert.deepEqual(sixteenGibibyteHost.floor, {
    residentSessions: 8,
    executingRuns: 4,
  });
  assert.deepEqual(
    sixteenGibibyteHost.assess({
      residentSessions: 8,
      executingRuns: 4,
      availableMemoryBytes: 8 * GIBIBYTE,
    }),
    { admitted: true },
  );
  assert.equal(sixteenGibibyteHost.retainedSessionLimit, undefined);
});
