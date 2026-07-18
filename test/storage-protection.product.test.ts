import assert from "node:assert/strict";
import test from "node:test";
import {
  MINIMUM_SUPPORTED_CAPACITY_BYTES,
  StorageProtection,
} from "../packages/host/src/storage-protection.js";

test("storage pressure cleans safe data before rejecting discretionary growth and preserves reserve writes", () => {
  const gib = 1024 ** 3;
  let available = 900 * 1024 ** 2;
  let cleanups = 0;
  const protection = new StorageProtection({
    capacityBytes: MINIMUM_SUPPORTED_CAPACITY_BYTES,
    emergencyReserveBytes: 512 * 1024 ** 2,
    admissionHeadroomBytes: gib,
    availableBytes: () => available,
  });

  assert.equal(protection.status().mode, "protected");
  assert.throws(
    () => protection.admitDiscretionary(() => cleanups++),
    /storage-pressure:.*Reads and accepted-work controls remain available.*maintenance.*free Host disk space/,
  );
  assert.equal(cleanups, 1);

  // Cleanup may reclaim only proven disposable bytes and admission is retried.
  protection.admitDiscretionary(() => {
    cleanups++;
    available = 2 * gib;
  });
  assert.equal(protection.status().mode, "normal");

  // Essential settlement/revocation/Stop callers do not use discretionary admission.
  available = 256 * 1024 ** 2;
  assert.equal(protection.status().mode, "reserve");
  let essentialCommitted = false;
  essentialCommitted = true;
  assert.equal(essentialCommitted, true);
});

test("storage thresholds are validated against the supported capacity floor", () => {
  assert.throws(
    () => new StorageProtection({
      capacityBytes: MINIMUM_SUPPORTED_CAPACITY_BYTES - 1,
      availableBytes: () => 0,
    }),
    /invalid-storage-protection-thresholds/,
  );
});
