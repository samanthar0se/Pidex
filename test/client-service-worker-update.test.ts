import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a complete shell activates without electing a Client and every Client settles before reload", async () => {
  const [worker, client] = await Promise.all([
    readFile("apps/client/public/service-worker.js", "utf8"),
    readFile("apps/client/src/main.tsx", "utf8"),
  ]);
  assert.match(worker, /await self\.skipWaiting\(\)/);
  assert.doesNotMatch(worker, /clients\.length|update-refused-multiple-clients/);
  assert.match(client, /controllerchange/);
  assert.match(client, /clientEnvironment\.settle\(\)/);
  assert.match(client, /status: "update-required"/);
});
