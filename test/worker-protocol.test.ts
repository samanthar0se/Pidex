import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WORKER_FRAME_BYTES,
  SessionWorkerProtocol,
  WorkerGenerationFailure,
  decodeWorkerFrame,
} from "../packages/worker-protocol/src/index.js";

const identity = {
  sessionId: "session-1",
  workerId: "worker-1",
  generation: 7,
  protocolGeneration: 1,
} as const;

function frame(type: string, sequence: number, body: object = {}) {
  return { type, ...identity, sequence, ...body };
}

test("worker IPC admits every bounded protocol family and rejects unknown data", () => {
  const frames = [
    frame("bootstrap", 0, { releaseGeneration: "r1", configGeneration: "c1", piGeneration: "0.80.10", cwd: "C:\\work" }),
    frame("ready", 1, { capabilities: [{ id: "run.execute", version: 1 }] }),
    frame("execute", 2, { correlationId: "run-1", prompt: "build" }),
    frame("fact", 3, { correlationId: "run-1", fact: { type: "assistant.delta", text: "ok" } }),
    frame("steer", 4, { correlationId: "run-1", text: "test too" }),
    frame("stop", 5, { correlationId: "run-1", reason: "user" }),
    frame("interaction.request", 6, { correlationId: "interaction-1", runCorrelationId: "run-1", interaction: { kind: "confirm", message: "continue?" } }),
    frame("interaction.response", 7, { correlationId: "interaction-1", response: { dismissed: false, value: true } }),
    frame("interaction.applied", 8, { correlationId: "interaction-1" }),
    frame("heartbeat", 9, { monotonicMs: 100 }),
    frame("checkpoint", 10, { correlationId: "run-1", checkpointId: "checkpoint-1", state: "published" }),
    frame("outcome", 11, { correlationId: "run-1", outcome: "completed", checkpointId: "checkpoint-1" }),
    frame("fault", 12, { scope: "run", correlationId: "run-1", code: "model-failed", retryable: false }),
  ];

  for (const value of frames) {
    assert.deepEqual(decodeWorkerFrame(JSON.stringify(value)), value);
  }
  assert.throws(
    () => decodeWorkerFrame(JSON.stringify({ ...frames[0], secret: true })),
    /malformed-worker-frame/,
  );
  assert.throws(() => decodeWorkerFrame("x".repeat(MAX_WORKER_FRAME_BYTES + 1)), /oversized-worker-frame/);
});

test("one protocol owner fails only its generation on identity, ordering, pressure, heartbeat, transport, exit, and hang faults", () => {
  const protocol = new SessionWorkerProtocol(identity, { now: () => 1_000, maxQueuedBytes: 120, heartbeatTimeoutMs: 30_000 });
  protocol.accept(frame("heartbeat", 0, { monotonicMs: 1 }));
  assert.throws(() => protocol.accept(frame("heartbeat", 0, { monotonicMs: 2 })), WorkerGenerationFailure);

  for (const operation of [
    () => new SessionWorkerProtocol(identity).accept({ ...frame("heartbeat", 0, { monotonicMs: 1 }), generation: 6 }),
    () => { const p = new SessionWorkerProtocol(identity, { maxQueuedBytes: 1 }); p.enqueue(decodeWorkerFrame(JSON.stringify(frame("heartbeat", 0, { monotonicMs: 1 })))); },
    () => { const p = new SessionWorkerProtocol(identity, { now: () => 31_001 }); p.noteHeartbeat(0); p.checkHeartbeat(); },
    () => new SessionWorkerProtocol(identity).transportDisconnected(),
    () => new SessionWorkerProtocol(identity).workerExited(1),
    () => new SessionWorkerProtocol(identity).executionHung("run-1"),
  ]) {
    assert.throws(operation, (error: unknown) => error instanceof WorkerGenerationFailure && error.generation === 7);
  }
});
