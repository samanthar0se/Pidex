import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop shell exposes the complete single-view Session workflow", async () => {
  const [shell, application] = await Promise.all([
    readFile("apps/pwa/index.html", "utf8"),
    readFile("apps/pwa/app.js", "utf8"),
  ]);

  for (const surface of [
    "New Session",
    "Search Sessions",
    "Archived",
    "Session Timeline",
    "Open Interactions",
    "Fork",
    "Archive",
    "Stop",
  ]) {
    assert.match(shell, new RegExp(surface));
  }
  assert.match(shell, /Nothing is created on the Host until/);
  assert.doesNotMatch(shell, /active Session|idle Session|Attention|split view/i);

  assert.match(application, /addEventListener\("popstate", route\)/);
  assert.match(application, /addEventListener\("offline"/);
  assert.match(application, /visibilitychange/);
  assert.match(
    application,
    /controlSocket\.onclose = event => {[\s\S]*?scheduleReconnect\(\);\s+};/,
  );
  assert.match(application, /function scheduleReconnect\(\)/);
  assert.match(
    application,
    /reconnectTimer = setTimeout\([\s\S]*?authenticateStoredDevice\(\);[\s\S]*?}, delay\)/,
  );
  assert.match(application, /session\.fork/);
  assert.match(application, /session\.rename/);
  assert.match(application, /run\.release/);
  assert.match(application, /run\.cancel/);
  assert.match(application, /interaction\.resolve/);
  assert.match(application, /loadOlder/);
  assert.match(application, /state\.pending/);
});
