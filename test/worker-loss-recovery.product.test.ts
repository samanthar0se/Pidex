import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { WorkerLossError } from "../packages/host/src/pi-worker.js";
import type { ServerMessage } from "../packages/protocol/src/status.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

type RunCompletedMessage = Extract<
  ServerMessage,
  { type: "run.completed" }
>;

test(
  "worker channel loss interrupts only its Session and preserves its partial history",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pidex-worker-loss-"));
    const adapters = adaptersFor("deterministic");
    const originalExecute = adapters.pi.execute;
    assert.ok(originalExecute);
    adapters.pi.execute = async request => {
      if (request.prompt === "lose worker") {
        request.onTimelineEvent?.({
          type: "assistant.delta",
          text: "partial",
        });
        throw new WorkerLossError("worker-channel-lost");
      }
      return originalExecute(request);
    };
    const host = await startHost({
      dataDir,
      port: 0,
      authorization: "test",
      adapters,
    });
    let socket: WebSocket | undefined;
    try {
      socket = new WebSocket(
        `${host.origin.replace("https:", "wss:")}/control`,
        {
          rejectUnauthorized: false,
          headers: { authorization: "Bearer test" },
        },
      );
      await negotiateControl(socket);
      const lostSessionId = await createSession(socket, "lost");
      const siblingSessionId = await createSession(socket, "sibling");
      socket.send(JSON.stringify({
        type: "run.submit",
        commandId: "r1",
        sessionId: lostSessionId,
        prompt: "lose worker",
        requiredCapability: "run.submit",
      }));
      socket.send(JSON.stringify({
        type: "run.submit",
        commandId: "r2",
        sessionId: siblingSessionId,
        prompt: "fine",
        requiredCapability: "run.submit",
      }));

      const completions: RunCompletedMessage[] = [];
      while (completions.length < 2) {
        const message = await nextControlMessage(socket);
        if (message.type === "run.completed") {
          completions.push(message);
        }
      }
      const interrupted = completions.find(
        item => item.run.sessionId === lostSessionId,
      );
      const completed = completions.find(
        item => item.run.sessionId === siblingSessionId,
      );
      assert.ok(interrupted);
      assert.ok(completed);
      assert.equal(interrupted.run.state, "interrupted");
      assert.equal(completed.run.state, "completed");
      assert.ok(
        interrupted.timeline.some(item => item.text.includes("partial")),
      );
      assert.ok(
        interrupted.timeline.some(item =>
          item.text.includes("Worker recovery"),
        ),
      );
    } finally {
      socket?.close();
      await host.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);

async function createSession(
  socket: WebSocket,
  commandId: string,
): Promise<string> {
  socket.send(JSON.stringify({
    type: "session.create",
    commandId,
  }));
  await nextControlMessage(socket);
  const changeSet = await nextControlMessage(socket);
  assert.equal(changeSet.type, "host.change-set");
  if (
    changeSet.type !== "host.change-set" ||
    changeSet.changes[0]?.type !== "session.created"
  ) {
    throw new Error("missing session");
  }
  return changeSet.changes[0].session.sessionId;
}
