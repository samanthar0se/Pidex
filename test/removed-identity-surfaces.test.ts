import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("obsolete identity, push, and legacy PWA product surfaces are absent", () => {
  for (const path of [
    "apps/pwa",
    "packages/host/src/pairing.ts",
    "packages/host/src/advisory-push.ts",
  ]) {
    assert.equal(existsSync(path), false, `${path} must be deleted`);
  }

  const activeFiles = execFileSync("git", ["ls-files", "packages", "apps/client", "test"], {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean).filter(path =>
    existsSync(path) && !path.startsWith("apps/client/dist/") &&
    path !== "test/removed-identity-surfaces.test.ts"
  );
  const forbidden = /\b(?:PairingAuthority|pairingId|authenticationId|revokeDevice|revoked_devices|devicePublicKey|advisory[ -]?push|pushManager|push-reconcile)\b|\/pair\/(?:challenge|complete|auth-challenge|authenticate)|pair-device/i;
  const violations = activeFiles.filter(path => forbidden.test(readFileSync(path, "utf8")));

  assert.deepEqual(violations, []);
});
