import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

test("Session Views are lifecycle-neutral and Sleep requires flushed quiescence", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-residency-"));
  const adapters = adaptersFor("deterministic");
  let flushes = 0;
  let releaseExecution!: () => void;
  const executionGate = new Promise<void>(resolve => { releaseExecution = resolve; });
  const originalExecute = adapters.pi.execute!;
  adapters.pi.execute = async request => {
    await executionGate;
    return originalExecute(request);
  };
  const originalFlush = adapters.pi.flushCheckpoint!;
  adapters.pi.flushCheckpoint = async (sessionId, checkpoint) => {
    flushes++;
    return originalFlush(sessionId, checkpoint);
  };
  const host = await startHost({ dataDir, port: 0, authorization: "test", adapters });
  try {
    const socket = new WebSocket(`${host.origin.replace("https:", "wss:")}/control`, {
      rejectUnauthorized: false, headers: { authorization: "Bearer test" },
    });
    await negotiateControl(socket);
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") throw new Error("missing Session");
    const sessionId = created.changes[0]!.session.sessionId;

    socket.send(JSON.stringify({ type: "view.observe", sessionId, viewId: "v", draftRevision: 0 }));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(host.status().synchronization.cursor, created.cursor);

    socket.send(JSON.stringify({ type: "run.submit", commandId: "run", sessionId,
      prompt: "hello", requiredCapability: "run.submit" }));
    await nextControlMessage(socket);
    // Running/queued lifecycle state prevents disposal.
    socket.send(JSON.stringify({ type: "session.sleep", commandId: "busy", sessionId }));
    const busy = await nextControlMessage(socket);
    assert.equal(busy.type, "command.outcome");
    if (busy.type === "command.outcome") assert.equal(busy.outcome, "rejected");
    releaseExecution();

    while (true) {
      const message = await nextControlMessage(socket);
      if (message.type === "run.completed") break;
    }
    socket.send(JSON.stringify({ type: "session.sleep", commandId: "sleep", sessionId }));
    const slept = await nextControlMessage(socket);
    assert.equal(slept.type, "command.outcome");
    assert.equal(flushes, 2); // Run settlement flush plus Sleep boundary flush.
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
