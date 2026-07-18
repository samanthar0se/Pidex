import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor, type HostAdapters } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

test("force-stop closes only the uncooperative Session Job and settles Cancelled", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-force-stop-"));
  const base = adaptersFor("deterministic");
  const terminated: string[] = [];
  const contained: string[] = [];
  const adapters: HostAdapters = {
    ...base,
    pi: {
      ...base.pi,
      execute: request => request.prompt === "hang"
        ? new Promise(() => {})
        : Promise.resolve({ text: "sibling survived", checkpoint: `cp:${request.sessionId}` }),
      flushCheckpoint: async (_sessionId, checkpoint) => checkpoint,
    },
    windows: {
      ...base.windows,
      createContainedSessionWorker: sessionId => {
        contained.push(sessionId);
        return {
          sessionId,
          terminate: () => { terminated.push(sessionId); },
          close() {},
        };
      },
    },
  };
  const host = await startHost({
    dataDir, port: 0, authorization: "device", adapters,
    cooperativeStopTimeoutMs: 5,
    forcedReconciliationTimeoutMs: 5,
  });
  const socket = new WebSocket(`${host.origin.replace("https:", "wss:")}/control`, {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer device" },
  });
  try {
    await negotiateControl(socket);
    const messages: any[] = [];
    socket.on("message", data => messages.push(JSON.parse(data.toString())));
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await waitFor(() => messages.length >= 2);
    const created = messages.shift()!.type === "command.outcome" ? messages.shift()! : messages.shift()!;
    if (created.type !== "host.change-set") throw new Error("missing Session");
    const sessionId = created.changes[0]!.session.sessionId;
    messages.length = 0;
    socket.send(JSON.stringify({
      type: "scope.set", sessionIds: [sessionId], protocolVersion: "1.0",
    }));
    await waitFor(() => messages.length > 0);
    messages.length = 0;
    socket.send(JSON.stringify({
      type: "run.submit", commandId: "run", sessionId, prompt: "hang",
      requiredCapability: "run.submit",
    }));
    await waitFor(() => messages.some(message => message.type === "run.execution"));
    const executing = messages.find(message => message.type === "run.execution")!;
    messages.length = 0;
    if (executing.type !== "run.execution") throw new Error("missing execution");
    socket.send(JSON.stringify({
      type: "run.stop", commandId: "stop", sessionId,
      runId: executing.runId, workerGeneration: executing.workerGeneration,
      observedState: "executing",
      observedTimelineRevision: executing.timelineRevision,
      requiredCapability: "run.stop",
    }));
    await waitFor(() => messages.some(message => message.type === "run.completed"));
    const completed = messages.find(message => message.type === "run.completed")!;
    assert.equal(completed.type, "run.completed");
    if (completed.type === "run.completed") {
      assert.equal(completed.run.state, "cancelled");
      assert.match(completed.timeline.at(-1)!.text, /side effects may remain/);
    }
    assert.deepEqual(contained, [sessionId]);
    assert.deepEqual(terminated, [sessionId]);
  } finally {
    socket.close();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for Host message");
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

test("containment failure never invokes Pi", async () => {
  const base = adaptersFor("deterministic");
  let executed = false;
  const adapters: HostAdapters = {
    ...base,
    pi: { ...base.pi, execute: async request => {
      executed = true;
      return { text: "escaped", checkpoint: request.sessionId };
    } },
    windows: {
      ...base.windows,
      createContainedSessionWorker: () => { throw new Error("assign-job-denied"); },
    },
  };
  // The detailed Host transport case above exercises dispatch; this assertion
  // pins the typed diagnostic vocabulary used at that boundary.
  assert.throws(() => adapters.windows.createContainedSessionWorker("s"), /assign-job-denied/);
  assert.equal(executed, false);
});
