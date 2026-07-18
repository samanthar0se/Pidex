import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { serverMessageSchema, type ServerMessage } from "../packages/protocol/src/status.js";

function next(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", data => resolve(serverMessageSchema.parse(JSON.parse(data.toString()))));
    socket.once("error", reject);
  });
}
async function connect(origin: string, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`${origin.replace("https:", "wss:")}/control`, { rejectUnauthorized: false, headers: { authorization: `Bearer ${token}` } });
  await next(socket);
  return socket;
}

test("concurrent rename rejects stale intent and replays a durable Device-scoped receipt", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-receipts-"));
  const options = { dataDir, port: 0, authorization: "device-a", adapters: adaptersFor("deterministic") };
  let host = await startHost(options);
  try {
    const a = await connect(host.origin, "device-a");
    a.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await next(a);
    const created = await next(a);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") throw new Error("expected creation");
    const sessionId = created.changes[0]!.session.sessionId;
    const rename = { type: "session.rename", commandId: "rename-1", sessionId, name: "Alpha", requiredCapability: "session.rename", observedMetadataRevision: 1 };
    a.send(JSON.stringify(rename));
    const accepted = await next(a);
    assert.equal(accepted.type, "command.outcome");
    await next(a);
    a.send(JSON.stringify({ ...rename, commandId: "rename-2", name: "Beta" }));
    const stale = await next(a);
    assert.equal(stale.type, "command.outcome");
    if (stale.type === "command.outcome") {
      assert.equal(stale.error, "stale-precondition");
      assert.equal(stale.currentMetadataRevision, 2);
    }
    const receipt = accepted.type === "command.outcome" ? accepted.receipt : undefined;
    a.close();
    await host.close();

    host = await startHost(options);
    const retry = await connect(host.origin, "device-a");
    retry.send(JSON.stringify(rename));
    assert.deepEqual(await next(retry), accepted);
    retry.send(JSON.stringify({ ...rename, name: "Changed reuse" }));
    const conflict = await next(retry);
    assert.equal(conflict.type === "command.outcome" && conflict.error, "command-id-conflict");
    assert.ok(receipt?.digest);
    retry.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
