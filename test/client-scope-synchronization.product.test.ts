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
    socket.once("message", bytes => resolve(serverMessageSchema.parse(JSON.parse(bytes.toString()))));
    socket.once("error", reject);
  });
}

async function connect(origin: string): Promise<{ socket: WebSocket; cursor: string }> {
  const socket = new WebSocket(`${origin.replace("https:", "wss:")}/control`, {
    rejectUnauthorized: false, headers: { authorization: "Bearer device" },
  });
  const snapshot = await next(socket);
  assert.equal(snapshot.type, "host.snapshot");
  if (snapshot.type !== "host.snapshot") throw new Error("snapshot expected");
  return { socket, cursor: snapshot.status.synchronization.cursor };
}

test("Client scopes resume retained changes and reset atomically across broken continuity", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-sync-"));
  const otherDir = await mkdtemp(join(tmpdir(), "pidex-sync-other-"));
  const options = { dataDir, port: 0, authorization: "device", adapters: adaptersFor("deterministic") };
  let host = await startHost(options);
  let other = await startHost({ ...options, dataDir: otherDir });
  try {
    const first = await connect(host.origin);
    const originalCursor = first.cursor;
    first.socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await next(first.socket);
    const created = await next(first.socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") throw new Error("change expected");
    const session = created.changes[0]?.session;
    assert.ok(session);
    first.socket.close(); // Treat the delivered Change Set acknowledgement as dropped.

    await host.close();
    host = await startHost(options);
    const resumed = await connect(host.origin);
    resumed.socket.send(JSON.stringify({ type: "scope.set", protocolVersion: "1.0", sessionIds: [], cursor: originalCursor }));
    const redelivered = await next(resumed.socket);
    assert.equal(redelivered.type, "host.change-set");
    assert.equal((await next(resumed.socket)).type, "scope.current");

    resumed.socket.send(JSON.stringify({ type: "scope.set", protocolVersion: "1.0", sessionIds: [session.sessionId], cursor: redelivered.type === "host.change-set" ? redelivered.cursor : undefined }));
    assert.equal((await next(resumed.socket)).type, "scope.current");
    const added = await next(resumed.socket);
    assert.equal(added.type, "scope.reset");
    if (added.type === "scope.reset") assert.equal(added.barrier.scope.kind, "session");

    resumed.socket.send(JSON.stringify({ type: "scope.set", protocolVersion: "1.0", sessionIds: [], cursor: redelivered.type === "host.change-set" ? redelivered.cursor : undefined, resourceRevisions: { [session.sessionId]: 99 } }));
    const revisionReset = await next(resumed.socket);
    assert.equal(revisionReset.type, "scope.reset");
    if (revisionReset.type === "scope.reset") assert.equal(revisionReset.reason, "revision-mismatch");

    host.rotateSynchronizationEpoch();
    resumed.socket.send(JSON.stringify({ type: "scope.set", protocolVersion: "1.0", sessionIds: [], cursor: originalCursor }));
    const epochReset = await next(resumed.socket);
    assert.equal(epochReset.type, "scope.reset");
    if (epochReset.type === "scope.reset") assert.equal(epochReset.reason, "epoch-mismatch");

    const another = await connect(other.origin);
    another.socket.send(JSON.stringify({ type: "scope.set", protocolVersion: "1.0", sessionIds: [], cursor: originalCursor }));
    const hostReset = await next(another.socket);
    assert.equal(hostReset.type, "scope.reset");
    if (hostReset.type === "scope.reset") assert.equal(hostReset.reason, "host-mismatch");
    resumed.socket.close(); another.socket.close();
  } finally {
    await host.close(); await other.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});
