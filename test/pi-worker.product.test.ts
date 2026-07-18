import assert from "node:assert/strict";
import test from "node:test";
import type { PiAdapter } from "../packages/adapters/src/index.js";
import {
  BUNDLED_PI_SDK_GENERATION,
  PiSessionWorker,
  WORKER_PROTOCOL_GENERATION,
} from "../packages/host/src/pi-worker.js";

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
      capabilities: ["run.execute", "checkpoint.durable"],
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
