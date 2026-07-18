import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Device storage is bounded, observable, and cleaned only by authenticated revocation", async () => {
  const [application, shell] = await Promise.all([
    readFile("apps/pwa/app.js", "utf8"),
    readFile("apps/pwa/index.html", "utf8"),
  ]);

  assert.match(application, /DEFAULT_CACHE_BUDGET_BYTES/);
  assert.match(application, /navigator\.storage\.persist\(\)/);
  assert.match(application, /navigator\.storage\.estimate\(\)/);
  assert.match(application, /enforceCacheBudget/);
  assert.match(application, /lastViewed/);
  assert.match(application, /currentSessionId\(\)/);
  assert.match(application, /clearSessionData/);
  assert.match(application, /clearAllDeviceData/);
  assert.match(application, /event\.code === 4003/);
  assert.match(application, /cleanupRevokedDevice/);
  assert.doesNotMatch(application, /catch[^}]+cleanupRevokedDevice/s);

  assert.match(shell, /id="storage-usage"/);
  assert.match(shell, /Clear Session data/);
  assert.match(shell, /Clear all local data/);
  assert.match(shell, /revocation is\s+not remote wipe/i);
  assert.match(shell, /offline copies and backups may retain cached content/i);
  assert.match(shell, /re-pairing is required/i);
});
