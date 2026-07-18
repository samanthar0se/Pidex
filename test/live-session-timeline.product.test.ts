import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { protocolVersion, type ServerMessage } from "../packages/protocol/src/status.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

test("a current Session receives consolidated revisioned model and tool activity", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-live-timeline-"));
  const adapters = adaptersFor("deterministic");
  adapters.pi.execute = async request => {
    request.onTimelineEvent?.({ type: "assistant.delta", text: "hel" });
    request.onTimelineEvent?.({ type: "assistant.delta", text: "lo" });
    request.onTimelineEvent?.({ type: "tool.started", toolCallId: "call-1", name: "read" });
    request.onTimelineEvent?.({ type: "tool.completed", toolCallId: "call-1", name: "read", text: "done" });
    return { text: "hello", checkpoint: "cp-live" };
  };
  const host = await startHost({ dataDir, port: 0, authorization: "device", adapters });
  try {
    const socket = new WebSocket(`${host.origin.replace("https:", "wss:")}/control`, {
      rejectUnauthorized: false, headers: { authorization: "Bearer device" },
    });
    await negotiateControl(socket);
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") throw new Error("missing Session");
    const sessionId = created.changes[0]!.session.sessionId;
    socket.send(JSON.stringify({ type: "scope.set", sessionIds: [sessionId], protocolVersion }));
    let reset = await nextControlMessage(socket);
    if (reset.type === "scope.reset" && reset.barrier.scope.kind === "host") {
      reset = await nextControlMessage(socket);
    }
    assert.equal(reset.type, "scope.reset");
    socket.send(JSON.stringify({ type: "run.submit", commandId: "run", sessionId, prompt: "go", requiredCapability: "run.submit" }));
    assert.equal((await nextControlMessage(socket)).type, "command.outcome");
    const changes: Array<Extract<ServerMessage, { type: "timeline.change" }>> = [];
    while (true) {
      const message = await nextControlMessage(socket);
      if (message.type === "timeline.change") changes.push(message);
      if (message.type === "run.completed") break;
    }
    assert.ok(changes.length >= 6);
    changes.forEach((change, index) => {
      if (index) assert.equal(change.baseRevision, changes[index - 1]!.revision);
    });
    const assistant = changes.filter(item => item.entry.kind === "assistant");
    assert.equal(assistant.at(-1)?.entry.text, "hello");
    assert.equal(assistant.at(-1)?.entry.finalized, true);
    assert.equal(new Set(assistant.map(item => item.entry.entryId)).size, 1);
    assert.equal(changes.find(item => item.entry.kind === "tool")?.entry.runId !== null, true);
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
