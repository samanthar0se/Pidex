import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("development prerequisite check explains how to expose OpenSSL", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-development-prerequisites.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /development requires OpenSSL/i);
  assert.match(result.stderr, /C:\\Program Files\\Git\\mingw64\\bin/);
  assert.match(result.stderr, /openssl version/);
});
