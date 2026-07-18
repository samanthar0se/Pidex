import assert from "node:assert/strict";
import test from "node:test";
import type { PiAdapter } from "../packages/adapters/src/index.js";
import {
  BUNDLED_PI_SDK_GENERATION,
  PiSessionWorker,
  WORKER_PROTOCOL_GENERATION,
} from "../packages/host/src/pi-worker.js";

test("the Pi contract admits versioned constrained controls and preserves optional semantics", async () => {
  const pi: PiAdapter = {
    kind: "deterministic",
    probe: async request => ({
      ...request,
      capabilities: [
        { id: "run.execute", version: 1 },
        { id: "checkpoint.durable", version: 1 },
        {
          id: "model.select",
          version: 1,
          constraints: { values: ["pi-model"] },
        },
        {
          id: "mode.select",
          version: 1,
          constraints: { values: ["agent"] },
        },
        {
          id: "input.text",
          version: 1,
          constraints: { maximumBytes: 4096 },
        },
        { id: "future.optional", version: 1 },
      ],
    }),
    execute: async () => ({ text: "ok", checkpoint: "cp" }),
  };

  const capabilities = await PiSessionWorker.probe(pi);
  assert.deepEqual(
    capabilities.find(item => item.id === "model.select")?.constraints,
    { values: ["pi-model"] },
  );
  assert.ok(capabilities.some(item => item.id === "future.optional"));
});

test(
  "the Pi contract reports malformed and version-shifted readiness diagnostically",
  async () => {
    for (const capability of [
      { id: "run.execute", version: 2 },
      { id: "input.text", version: 1, constraints: { maximumBytes: -1 } },
    ]) {
      const pi: PiAdapter = {
        kind: "deterministic",
        probe: async request => ({ ...request, capabilities: [capability] }),
        execute: async () => ({ text: "no", checkpoint: "no" }),
      };
      await assert.rejects(
        PiSessionWorker.probe(pi),
        /worker-readiness-schema-mismatch/,
      );
    }
  },
);

test("a Pi worker rejects a readiness response without every required capability", async () => {
  let didExecute = false;
  const pi: PiAdapter = {
    kind: "deterministic",
    probe: async request => ({
      ...request,
      capabilities: ["run.execute"],
    }),
    execute: async () => {
      didExecute = true;
      return { text: "unreachable", checkpoint: "unreachable" };
    },
    flushCheckpoint: async (_sessionId, checkpoint) => checkpoint,
  };

  const worker = new PiSessionWorker("session-1", pi);
  await assert.rejects(
    worker.execute("hello"),
    /missing-required-worker-capability/,
  );
  assert.equal(didExecute, false);
});

test("a Pi worker rejects a mismatched protocol generation before execution", async () => {
  let didExecute = false;
  const pi: PiAdapter = {
    kind: "deterministic",
    probe: async () => ({
      protocolGeneration: WORKER_PROTOCOL_GENERATION + 1,
      sdkGeneration: BUNDLED_PI_SDK_GENERATION,
      capabilities: ["run.execute", "checkpoint.durable"],
    }),
    execute: async () => {
      didExecute = true;
      return { text: "unreachable", checkpoint: "unreachable" };
    },
    flushCheckpoint: async (_sessionId, checkpoint) => checkpoint,
  };

  const worker = new PiSessionWorker("session-1", pi);
  await assert.rejects(worker.execute("hello"), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /protocolGeneration/);
    return true;
  });
  assert.equal(didExecute, false);
});

test("a Pi worker returns completion only after durable checkpoint flush", async () => {
  const events: string[] = [];
  const pi: PiAdapter = {
    kind: "deterministic",
    probe: async request => ({
      ...request,
      capabilities: [
        "run.execute",
        "checkpoint.durable",
        "model.select",
        "mode.select",
        "input.text",
      ],
    }),
    execute: async () => {
      events.push("execute");
      return { text: "ok", checkpoint: "stable-1" };
    },
    flushCheckpoint: async (_sessionId, checkpoint) => {
      events.push("flush");
      return checkpoint;
    },
  };

  assert.deepEqual(await new PiSessionWorker("session-1", pi).execute("go"), {
    text: "ok",
    checkpoint: "stable-1",
  });
  assert.deepEqual(events, ["execute", "flush"]);
});

test("a Pi worker routes steering only to its active capable execution", async () => {
  const steeringTexts: string[] = [];
  let completeExecution: (() => void) | undefined;
  const pi: PiAdapter = {
    kind: "deterministic",
    probe: async request => ({
      ...request,
      capabilities: [
        "run.execute",
        "checkpoint.durable",
        "model.select",
        "mode.select",
        "input.text",
        "runtime.steer",
      ],
    }),
    execute: async request => {
      request.registerSteeringReceiver?.(async text => {
        steeringTexts.push(text);
      });
      await new Promise<void>(resolve => {
        completeExecution = resolve;
      });
      return { text: "ok", checkpoint: "cp-steering" };
    },
    flushCheckpoint: async (_sessionId, checkpoint) => checkpoint,
  };

  const worker = new PiSessionWorker("session-steering", pi);
  const execution = worker.execute("go");
  await new Promise(resolve => setImmediate(resolve));

  await worker.steer("also run tests");
  assert.deepEqual(steeringTexts, ["also run tests"]);

  assert.ok(completeExecution);
  completeExecution();
  await execution;
  await assert.rejects(worker.steer("too late"), /steering-unavailable/);
});

test("presentation effects are capability-gated, bounded, and remain inert data", async () => {
  const effects: unknown[] = [];
  const pi: PiAdapter = {
    kind: "deterministic",
    probe: async request => ({
      ...request,
      capabilities: [
        "run.execute",
        "checkpoint.durable",
        "model.select",
        "mode.select",
        "input.text",
        "presentation.status",
        "presentation.title",
      ],
    }),
    execute: async request => {
      request.onPresentationEffect?.({
        type: "status",
        key: "build",
        text: "running",
      });
      request.onPresentationEffect?.({
        type: "status",
        key: "build",
        text: null,
      });
      request.onPresentationEffect?.({
        type: "title",
        text: "<img src=x onerror=alert(1)>",
      });
      request.onPresentationEffect?.({
        type: "widget",
        key: "hidden",
        text: "unsupported",
      });
      return { text: "ok", checkpoint: "cp-effects" };
    },
    flushCheckpoint: async (_sessionId, checkpoint) => checkpoint,
  };

  await new PiSessionWorker("session-effects", pi).execute(
    "go",
    undefined,
    effect => effects.push(effect),
  );
  assert.deepEqual(effects, [
    { type: "status", key: "build", text: "running" },
    { type: "status", key: "build", text: null },
    { type: "title", text: "<img src=x onerror=alert(1)>" },
  ]);

  pi.execute = async request => {
    request.onPresentationEffect?.({ type: "title", text: "x".repeat(16_385) });
    return { text: "unreachable", checkpoint: "cp" };
  };
  await assert.rejects(new PiSessionWorker("session-effects", pi).execute("go"));
});
