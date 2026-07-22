import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

const REMOVED_PRODUCT_PATHS = [
  "apps/pwa",
  "packages/host/src/pairing.ts",
  "packages/host/src/advisory-push.ts",
];

const REMOVED_SURFACES = [
  {
    name: "pairing and Device authority contracts",
    pattern:
      /\b(?:PairingAuthority|pairingId|authenticationId|revokeDevice|revoked_devices|devicePublicKey)\b/i,
  },
  {
    name: "Device-keyed advisory push",
    pattern: /\b(?:advisory[ -]?push|pushManager|push-reconcile)\b/i,
  },
  {
    name: "pairing routes",
    pattern: /\/pair\/(?:challenge|complete|auth-challenge|authenticate)/i,
  },
  { name: "pairing UI", pattern: /pair-device/i },
];

test("legacy PWA, pairing, and advisory push product paths are deleted", () => {
  for (const path of REMOVED_PRODUCT_PATHS) {
    assert.equal(existsSync(path), false, `${path} must be deleted`);
  }
});

test("active product code contains no removed identity or push surfaces", () => {
  const activeFiles = execFileSync("git", ["ls-files", "packages", "apps/client", "test"], {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean).filter(path =>
    existsSync(path) && !path.startsWith("apps/client/dist/") &&
    path !== "test/removed-identity-surfaces.test.ts"
  );

  for (const surface of REMOVED_SURFACES) {
    const violations = activeFiles.filter(path =>
      surface.pattern.test(readFileSync(path, "utf8"))
    );
    assert.deepEqual(violations, [], `${surface.name} must remain deleted`);
  }
});
