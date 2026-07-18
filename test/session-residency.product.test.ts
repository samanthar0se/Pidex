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
  let flushCount = 0;
  let releaseExecution!: () => void;
  const executionGate = new Promise<void>(resolve => {
    releaseExecution = resolve;
  });
  const originalExecute = adapters.pi.execute!;
  adapters.pi.execute = async request => {
    await executionGate;
    return originalExecute(request);
  };
  const originalFlush = adapters.pi.flushCheckpoint!;
  adapters.pi.flushCheckpoint = async (sessionId, checkpoint) => {
    flushCount++;
    return originalFlush(sessionId, checkpoint);
  };
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "test",
    adapters,
  });
  try {
    const socket = new WebSocket(
      `${host.origin.replace("https:", "wss:")}/control`,
      {
        rejectUnauthorized: false,
        headers: { authorization: "Bearer test" },
      },
    );
    await negotiateControl(socket);
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") {
      throw new Error("missing Session");
    }
    const createdChange = created.changes[0];
    assert.equal(createdChange?.type, "session.created");
    if (createdChange?.type !== "session.created") {
      throw new Error("missing Session creation change");
    }
    const sessionId = createdChange.session.sessionId;

    socket.send(JSON.stringify({
      type: "view.observe",
      sessionId,
      viewId: "v",
      draftRevision: 0,
    }));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(host.status().synchronization.cursor, created.cursor);

    socket.send(JSON.stringify({
      type: "run.submit",
      commandId: "run",
      sessionId,
      prompt: "hello",
      requiredCapability: "run.submit",
    }));
    await nextControlMessage(socket);
    socket.send(JSON.stringify({
      type: "session.sleep",
      commandId: "busy",
      sessionId,
    }));
    const busy = await nextControlMessage(socket);
    assert.equal(busy.type, "command.outcome");
    if (busy.type !== "command.outcome") {
      throw new Error("missing busy Sleep outcome");
    }
    assert.equal(busy.outcome, "rejected");
    assert.equal(busy.error, "session-not-quiescent");
    releaseExecution();

    while (true) {
      const message = await nextControlMessage(socket);
      if (message.type === "run.completed") break;
    }
    socket.send(JSON.stringify({
      type: "session.sleep",
      commandId: "sleep",
      sessionId,
    }));
    const slept = await nextControlMessage(socket);
    assert.equal(slept.type, "command.outcome");
    if (slept.type !== "command.outcome") {
      throw new Error("missing successful Sleep outcome");
    }
    assert.equal(slept.outcome, "accepted");

    const residencyChange = await nextControlMessage(socket);
    assert.equal(residencyChange.type, "host.change-set");
    if (residencyChange.type !== "host.change-set") {
      throw new Error("missing residency change");
    }
    const changedResidency = residencyChange.changes[0];
    assert.equal(changedResidency?.type, "session.residency-changed");
    if (changedResidency?.type !== "session.residency-changed") {
      throw new Error("missing Session residency change");
    }
    assert.equal(changedResidency.session.residency, "sleeping");
    assert.equal(flushCount, 2);
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
