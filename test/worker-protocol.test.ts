import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WORKER_FRAME_BYTES,
  SessionGenerationLifecycle,
  SessionWorkerProtocol,
  WorkerGenerationFailure,
  configGeneration,
  decodeWorkerFrame,
  interactionId,
  runCorrelationId,
} from "../packages/worker-protocol/src/index.js";

const identity = {
  sessionId: "session-1",
  workerId: "worker-1",
  generation: 7,
  protocolGeneration: 1,
} as const;

function createFrame(type: string, sequence: number, body: object = {}) {
  return { type, ...identity, sequence, ...body };
}

test("worker IPC admits every bounded protocol family and rejects unknown data", () => {
  const frames = [
    createFrame("bootstrap", 0, {
      releaseGeneration: "r1",
      configGeneration: "c1",
      piGeneration: "0.80.10",
      cwd: "C:\\work",
    }),
    createFrame("ready", 1, {
      capabilities: [{ id: "run.execute", version: 1 }],
    }),
    createFrame("execute", 2, { correlationId: "run-1", prompt: "build" }),
    createFrame("fact", 3, {
      correlationId: "run-1",
      fact: { type: "assistant.delta", text: "ok" },
    }),
    createFrame("steer", 4, {
      correlationId: "run-1",
      text: "test too",
    }),
    createFrame("stop", 5, { correlationId: "run-1", reason: "user" }),
    createFrame("interaction.request", 6, {
      correlationId: "interaction-1",
      runCorrelationId: "run-1",
      interaction: { kind: "confirm", message: "continue?" },
    }),
    createFrame("interaction.response", 7, {
      correlationId: "interaction-1",
      response: { dismissed: false, value: true },
    }),
    createFrame("interaction.applied", 8, {
      correlationId: "interaction-1",
    }),
    createFrame("heartbeat", 9, { monotonicMs: 100 }),
    createFrame("checkpoint", 10, {
      correlationId: "run-1",
      checkpointId: "checkpoint-1",
      state: "published",
    }),
    createFrame("outcome", 11, {
      correlationId: "run-1",
      outcome: "completed",
      checkpointId: "checkpoint-1",
    }),
    createFrame("fault", 12, {
      scope: "run",
      correlationId: "run-1",
      code: "model-failed",
      retryable: false,
    }),
  ];

  for (const value of frames) {
    assert.deepEqual(decodeWorkerFrame(JSON.stringify(value)), value);
  }
  assert.throws(
    () => decodeWorkerFrame(JSON.stringify({ ...frames[0], secret: true })),
    /malformed-worker-frame/,
  );
  assert.throws(
    () => decodeWorkerFrame("x".repeat(MAX_WORKER_FRAME_BYTES + 1)),
    /oversized-worker-frame/,
  );
});

test("one protocol owner fails only its generation on identity, ordering, pressure, heartbeat, transport, exit, and hang faults", () => {
  const protocol = new SessionWorkerProtocol(identity, {
    now: () => 1_000,
    maxQueuedBytes: 120,
    heartbeatTimeoutMs: 30_000,
  });
  protocol.accept(createFrame("heartbeat", 0, { monotonicMs: 1 }));
  assert.throws(
    () => protocol.accept(createFrame("heartbeat", 0, { monotonicMs: 2 })),
    WorkerGenerationFailure,
  );

  for (const operation of [
    () =>
      new SessionWorkerProtocol(identity).accept({
        ...createFrame("heartbeat", 0, { monotonicMs: 1 }),
        generation: 6,
      }),
    () => {
      const protocol = new SessionWorkerProtocol(identity, {
        maxQueuedBytes: 1,
      });
      const heartbeat = decodeWorkerFrame(
        JSON.stringify(createFrame("heartbeat", 0, { monotonicMs: 1 })),
      );
      protocol.enqueue(heartbeat);
    },
    () => {
      const protocol = new SessionWorkerProtocol(identity, {
        now: () => 31_001,
      });
      protocol.noteHeartbeat(0);
      protocol.checkHeartbeat();
    },
    () => new SessionWorkerProtocol(identity).transportDisconnected(),
    () => new SessionWorkerProtocol(identity).workerExited(1),
    () => new SessionWorkerProtocol(identity).executionHung("run-1"),
  ]) {
    assert.throws(
      operation,
      (error: unknown) =>
        error instanceof WorkerGenerationFailure && error.generation === 7,
    );
  }
});

test("a generation lifecycle cancels cooperatively and never replays uncertain work", () => {
  const configA = configGeneration("config-a");
  const run1 = runCorrelationId("run-1");
  const lifecycle = new SessionGenerationLifecycle(identity, {
    requiredCapabilities: ["run.execute", "input.text", "model.select", "mode.select", "checkpoint.durable"],
  });
  lifecycle.ready([
    { id: "run.execute", version: 1 },
    { id: "input.text", version: 1 },
    { id: "model.select", version: 1 },
    { id: "mode.select", version: 1 },
    { id: "checkpoint.durable", version: 1 },
    { id: "runtime.cancel", version: 1 },
  ], configA);
  lifecycle.execute(run1);
  assert.equal(lifecycle.stop(run1), "requested");
  lifecycle.settle(run1, "cancelled", "checkpoint-1");
  assert.equal(lifecycle.runState, "cancelled");

  assert.throws(() => lifecycle.execute(run1), /run-correlation-reused/);
  assert.throws(() => lifecycle.configurationChanged(configGeneration("config-b")), /generation-replacement-required/);

  const disconnectedLifecycle = new SessionGenerationLifecycle(identity);
  disconnectedLifecycle.ready([{ id: "run.execute", version: 1 }], configA);
  disconnectedLifecycle.execute(runCorrelationId("run-uncertain"));
  disconnectedLifecycle.fail();
  assert.equal(disconnectedLifecycle.runState, "interrupted");
  assert.equal(disconnectedLifecycle.shouldReplay, false);
});

test("Interaction values require worker acknowledgement and generation loss withdraws them", () => {
  const interaction1 = interactionId("interaction-1");
  const interaction2 = interactionId("interaction-2");
  const run1 = runCorrelationId("run-1");
  const lifecycle = new SessionGenerationLifecycle(identity);
  lifecycle.ready([
    { id: "run.execute", version: 1 },
    { id: "interaction.basic", version: 1 },
  ], configGeneration("config-a"));
  lifecycle.execute(run1);
  lifecycle.openInteraction(interaction1, run1);
  lifecycle.respondInteraction(interaction1);
  assert.equal(lifecycle.interactionState(interaction1), "applying");
  lifecycle.acknowledgeInteraction(interaction1);
  assert.equal(lifecycle.interactionState(interaction1), "responded");

  lifecycle.openInteraction(interaction2, run1);
  lifecycle.respondInteraction(interaction2);
  lifecycle.fail();
  assert.equal(lifecycle.interactionState(interaction2), "withdrawn");
  assert.throws(() => lifecycle.acknowledgeInteraction(interaction2), /interaction-not-applying/);
});
