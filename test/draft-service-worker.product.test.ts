import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("drafts survive independently and shell updates cannot gain background authority", async () => {
  const [app, worker, host] = await Promise.all([
    readFile("apps/pwa/app.js", "utf8"),
    readFile("apps/pwa/service-worker.js", "utf8"),
    readFile("packages/host/src/host.ts", "utf8"),
  ]);

  assert.match(app, /DRAFT_STORE = "drafts"/);
  assert.match(app, /Draft is only in memory/);
  assert.match(app, /draft local and unsent/);
  assert.match(app, /persistAllDrafts\(\).*activate-shell/s);
  assert.match(app, /Update refused/);
  assert.match(app, /resetDisposableCache/);
  assert.doesNotMatch(app, /sync\.register/);

  assert.match(worker, /SHELL_GENERATION = "sha256-/);
  assert.match(worker, /Promise\.all\(\s*SHELL\.map/);
  assert.match(worker, /incomplete shell generation/);
  assert.match(worker, /Deliberately no skipWaiting/);
  assert.match(worker, /event\.data\?\.type !== "activate-shell"/);
  assert.match(worker, /clients\.length > 1/);
  assert.match(worker, /notificationclick/);
  assert.doesNotMatch(worker, /WebSocket|run\.submit|session\.create|backgroundsync/);
  assert.match(host, /"\/service-worker\.js"/);
});
