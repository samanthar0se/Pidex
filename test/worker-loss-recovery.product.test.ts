import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { WorkerLossError } from "../packages/host/src/pi-worker.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

test("worker channel loss interrupts only its Session and preserves its partial history", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-worker-loss-"));
  const adapters = adaptersFor("deterministic");
  const execute = adapters.pi.execute!;
  adapters.pi.execute = async request => {
    if (request.prompt === "lose worker") {
      request.onTimelineEvent?.({ type: "assistant.delta", text: "partial" });
      throw new WorkerLossError("worker-channel-lost");
    }
    return execute(request);
  };
  const host = await startHost({ dataDir, port: 0, authorization: "test", adapters });
  try {
    const socket = new WebSocket(`${host.origin.replace("https:", "wss:")}/control`, {
      rejectUnauthorized: false,
      headers: { authorization: "Bearer test" },
    });
    await negotiateControl(socket);
    const create = async (id: string) => {
      socket.send(JSON.stringify({ type: "session.create", commandId: id }));
      await nextControlMessage(socket);
      const change = await nextControlMessage(socket);
      assert.equal(change.type, "host.change-set");
      if (change.type !== "host.change-set" || change.changes[0]?.type !== "session.created") throw new Error("missing session");
      return change.changes[0].session.sessionId;
    };
    const lost = await create("lost");
    const sibling = await create("sibling");
    socket.send(JSON.stringify({ type: "run.submit", commandId: "r1", sessionId: lost, prompt: "lose worker", requiredCapability: "run.submit" }));
    socket.send(JSON.stringify({ type: "run.submit", commandId: "r2", sessionId: sibling, prompt: "fine", requiredCapability: "run.submit" }));

    const completions = [];
    while (completions.length < 2) {
      const message = await nextControlMessage(socket);
      if (message.type === "run.completed") completions.push(message);
    }
    const interrupted = completions.find(item => item.run.sessionId === lost)!;
    const completed = completions.find(item => item.run.sessionId === sibling)!;
    assert.equal(interrupted.run.state, "interrupted");
    assert.equal(completed.run.state, "completed");
    assert.ok(interrupted.timeline.some(item => item.text.includes("partial")));
    assert.ok(interrupted.timeline.some(item => item.text.includes("Worker recovery")));
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
