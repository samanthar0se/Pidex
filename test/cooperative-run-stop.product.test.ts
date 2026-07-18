import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor, type PiAdapter } from "../packages/adapters/src/index.js";
import { PiSessionWorker } from "../packages/host/src/pi-worker.js";
import { AuthorityStore, type StopCommand } from "../packages/host/src/store.js";

test("Stop is exact, retryable, and atomically cancels continuation without touching a sibling Session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidex-stop-"));
  const store = new AuthorityStore(join(dir, "authority.sqlite"), adaptersFor("deterministic"));
  try {
    const session = store.createSession(null, null, 1).session;
    const sibling = store.createSession(null, null, 1).session;
    const first = store.submitRun("device", { commandId: "first", sessionId: session.sessionId, prompt: "build", requiredCapability: "run.submit" }, 2);
    const next = store.submitRun("device", { commandId: "next", sessionId: session.sessionId, prompt: "deploy", requiredCapability: "run.follow-up" }, 3);
    const siblingRun = store.submitRun("device", { commandId: "sibling", sessionId: sibling.sessionId, prompt: "independent", requiredCapability: "run.submit" }, 3);
    assert.equal(first.kind, "accepted"); assert.equal(next.kind, "accepted"); assert.equal(siblingRun.kind, "accepted");
    if (first.kind !== "accepted") throw new Error("missing run");
    const interaction = store.createInteraction({ sessionId: session.sessionId, runId: first.run.runId, workerGeneration: 1, correlationId: "question", kind: "confirm", payload: { message: "continue?" }, createdAt: 4, deadlineAt: 10 }).interaction;
    const revision = store.projection().sessions.find(item => item.sessionId === session.sessionId)!.timelineRevision;
    const command: StopCommand = { commandId: "stop", sessionId: session.sessionId, runId: first.run.runId, workerGeneration: "worker-1", observedState: "executing", observedTimelineRevision: revision };
    assert.equal(store.acceptStop("device", { ...command, commandId: "stale", runId: "successor" }, "worker-1", 5).kind, "rejected");
    const stopped = store.acceptStop("device", command, "worker-1", 5);
    assert.equal(stopped.kind, "accepted");
    assert.deepEqual(store.runs(session.sessionId).map(run => run.state), ["cancelling", "cancelled"]);
    assert.equal(store.runs(sibling.sessionId)[0]?.state, "executing");
    assert.equal(store.loadInteraction(interaction.interactionId).state, "withdrawn");
    assert.equal(store.acceptStop("device", command, "worker-1", 6).kind, "replayed");
    const settled = store.settleRun(first.run.runId, "cancelled", "partial work retained; no rollback", null, 7);
    assert.equal(settled.run.state, "cancelled");
    assert.match(settled.timeline.at(-1)!.text, /no rollback/);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("worker cooperative Stop aborts Pi and waits for tool cleanup settlement", async () => {
  const events: string[] = [];
  const pi: PiAdapter = {
    kind: "deterministic",
    probe: async request => ({ ...request, capabilities: ["run.execute", "checkpoint.durable", "model.select", "mode.select", "input.text", "runtime.cancel"] }),
    execute: request => new Promise((resolve, reject) => {
      request.signal?.addEventListener("abort", () => {
        events.push("abort");
        setImmediate(() => { events.push("tool-cleaned"); reject(new Error("aborted")); });
      });
    }),
    flushCheckpoint: async (_sessionId, checkpoint) => checkpoint,
  };
  const worker = new PiSessionWorker("session", pi);
  const execution = worker.execute("run tool");
  await new Promise(resolve => setImmediate(resolve));
  worker.stop();
  await assert.rejects(execution, /aborted/);
  assert.deepEqual(events, ["abort", "tool-cleaned"]);
});
