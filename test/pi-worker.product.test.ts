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
        { id: "model.select", version: 1, constraints: { values: ["pi-model"] } },
        { id: "mode.select", version: 1, constraints: { values: ["agent"] } },
        { id: "input.text", version: 1, constraints: { maximumBytes: 4096 } },
        { id: "future.optional", version: 1 },
      ],
    }),
    execute: async () => ({ text: "ok", checkpoint: "cp" }),
  };

  const capabilities = await PiSessionWorker.probe(pi);
  assert.deepEqual(capabilities.find(item => item.id === "model.select")?.constraints,
    { values: ["pi-model"] });
  assert.ok(capabilities.some(item => item.id === "future.optional"));
});

test("the Pi contract reports malformed and version-shifted readiness diagnostically", async () => {
  for (const capability of [
    { id: "run.execute", version: 2 },
    { id: "input.text", version: 1, constraints: { maximumBytes: -1 } },
  ]) {
    const pi: PiAdapter = {
      kind: "deterministic",
      probe: async request => ({ ...request, capabilities: [capability] }),
      execute: async () => ({ text: "no", checkpoint: "no" }),
    };
    await assert.rejects(PiSessionWorker.probe(pi), /worker-readiness-schema-mismatch/);
  }
});

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
  };

  const worker = new PiSessionWorker("session-1", pi);
  await assert.rejects(worker.execute("hello"), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /protocolGeneration/);
    return true;
  });
  assert.equal(didExecute, false);
});
