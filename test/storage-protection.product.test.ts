import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ADMISSION_HEADROOM_BYTES,
  DEFAULT_EMERGENCY_RESERVE_BYTES,
  MINIMUM_SUPPORTED_CAPACITY_BYTES,
  StorageProtection,
} from "../packages/host/src/storage-protection.js";

const MEBIBYTE = 1024 ** 2;
const GIBIBYTE = 1024 ** 3;

test("protected mode cleans safe data before rejecting discretionary growth", () => {
  const available = 900 * MEBIBYTE;
  let cleanups = 0;
  const protection = new StorageProtection({
    capacityBytes: MINIMUM_SUPPORTED_CAPACITY_BYTES,
    emergencyReserveBytes: DEFAULT_EMERGENCY_RESERVE_BYTES,
    admissionHeadroomBytes: DEFAULT_ADMISSION_HEADROOM_BYTES,
    availableBytes: () => available,
  });

  assert.equal(protection.status().mode, "protected");
  assert.throws(
    () => protection.admitDiscretionary(() => cleanups++),
    /storage-pressure:.*Reads and accepted-work controls remain available.*maintenance.*free Host disk space/,
  );
  assert.equal(cleanups, 1);
});

test("discretionary growth is admitted when cleanup restores headroom", () => {
  let available = 900 * MEBIBYTE;
  let cleanups = 0;
  const protection = new StorageProtection({
    availableBytes: () => available,
  });

  protection.admitDiscretionary(() => {
    cleanups++;
    available = 2 * GIBIBYTE;
  });
  assert.equal(cleanups, 1);
  assert.equal(protection.status().mode, "normal");
});

test("storage at or below the emergency threshold is reported as reserve", () => {
  const protection = new StorageProtection({
    availableBytes: () => DEFAULT_EMERGENCY_RESERVE_BYTES / 2,
  });

  assert.equal(protection.status().mode, "reserve");
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
