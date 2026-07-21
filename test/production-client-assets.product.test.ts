import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";

function request(origin: string, path: string) {
  return new Promise<{ status?: number; headers: NodeJS.Dict<string | string[]>; body: string }>((resolve, reject) => {
    const call = get(new URL(path, origin), { rejectUnauthorized: false }, response => {
      response.setEncoding("utf8"); let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    call.on("error", reject);
  });
}

test("the Host serves the generated production Client at stable Session URLs", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-production-client-"));
  const host = await startHost({ dataDir, port: 0, adapters: adaptersFor("deterministic") });
  try {
    const shell = await request(host.origin, "/sessions/session_resume");
    assert.equal(shell.status, 200);
    const script = shell.body.match(/src="\/(assets\/index-[^"]+\.js)"/)?.[1];
    assert.ok(script, "Vite's generated hashed entry is present");
    const asset = await request(host.origin, `/${script}`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.match(asset.body, /Reconciling current Host data/);
    assert.equal((await request(host.origin, "/app.js")).status, 404);
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
