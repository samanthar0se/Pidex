import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startHost } from "../packages/host/src/host.js";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { readStatus } from "../packages/cli/src/main.js";
import type { ServerMessage } from "../packages/protocol/src/status.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function pwaStatus(origin: string): Promise<ServerMessage["status"]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace("https:", "wss:") + "/control", { rejectUnauthorized: false });
    ws.once("message", bytes => { ws.close(); resolve((JSON.parse(bytes.toString()) as ServerMessage).status); });
    ws.once("error", reject);
  });
}

test("HTTPS PWA and CLI observe durable authoritative Host status across restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-product-"));
  try {
    let host = await startHost({ dataDir, port: 0, adapters: adaptersFor("deterministic") });
    const shell = await fetch(host.origin).then(r => r.text());
    assert.match(shell, /Pidex Host/);
    const [pwa, cli] = await Promise.all([pwaStatus(host.origin), readStatus(host.origin)]);
    assert.deepEqual(pwa, cli);
    assert.equal(cli.readiness, "ready");
    assert.match(cli.synchronization.cursor, new RegExp(`^${cli.hostId}:`));
    await host.close();
    host = await startHost({ dataDir, port: 0, adapters: adaptersFor("deterministic") });
    assert.deepEqual(await readStatus(host.origin), cli);
    await host.close();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
