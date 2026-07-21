import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, PassThrough } from "node:stream";
import test from "node:test";
import {
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiTimelineEvent } from "../packages/adapters/src/index.js";
import {
  ExactPiChild,
  ExactPiWorkerEndpoint,
  EXACT_PI_VERSION,
} from "../packages/pi-worker/src/index.js";
import {
  SessionWorkerTransport,
  decodeWorkerFrame,
} from "../packages/worker-protocol/src/index.js";

function duplexPair(): [Duplex, Duplex] {
  const leftToRight = new PassThrough();
  const rightToLeft = new PassThrough();
  // Duplex.from's object overload is not present in every supported Node lane.
  const makeBridge = (readable: PassThrough, writable: PassThrough) => {
    const stream = new Duplex({
      read() {},
      write(chunk, encoding, callback) { writable.write(chunk, encoding, callback); },
      final(callback) { writable.end(callback); },
    });
    readable.on("data", chunk => stream.push(chunk));
    readable.on("end", () => stream.push(null));
    return stream;
  };
  return [
    makeBridge(rightToLeft, leftToRight),
    makeBridge(leftToRight, rightToLeft),
  ];
}

async function readFrames(stream: Duplex, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const frames: unknown[] = [];
    stream.on("data", chunk => {
      bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
      while (bytes.length >= 4 && bytes.length >= bytes.readUInt32BE(0) + 4) {
        const length = bytes.readUInt32BE(0);
        frames.push(decodeWorkerFrame(bytes.subarray(4, length + 4)));
        bytes = bytes.subarray(length + 4);
        if (frames.length === count) resolve(frames);
      }
    });
    stream.once("error", reject);
  });
}

test("the exact Pi child endpoint binds through authenticated Session IPC and returns terminal evidence", async () => {
  const [host, childStream] = duplexPair();
  const identity = {
    sessionId: "session-ipc",
    workerId: "worker-ipc",
    generation: 3,
    protocolGeneration: 1,
  } as const;
  const fakeChild = {
    binding: { ...identity, cwd: "/canonical", agentDir: "/profile" },
    execute: async (_prompt: string, onEvent?: (event: PiTimelineEvent) => void) => {
      onEvent?.({ type: "assistant.delta", text: "offline" });
      return { text: "offline", checkpoint: "checkpoint-3" };
    },
    dispose: async () => {},
  };
  const endpoint = new ExactPiWorkerEndpoint(childStream, identity, {
    authenticationToken: "a".repeat(64),
    bind: async binding => {
      assert.equal(binding.cwd, "/canonical");
      return fakeChild;
    },
    agentDir: "/profile",
  });
  const output = readFrames(host, 4);

  host.write(SessionWorkerTransport.frame({
    ...identity,
    type: "bootstrap",
    sequence: 0,
    authenticationToken: "a".repeat(64),
    releaseGeneration: "release-1",
    configGeneration: "config-1",
    piGeneration: EXACT_PI_VERSION,
    cwd: "/canonical",
  }));
  host.write(SessionWorkerTransport.frame({
    ...identity,
    type: "execute",
    sequence: 1,
    correlationId: "run-1",
    prompt: "offline prompt",
  }));

  const frames = await output;
  assert.deepEqual(frames.map(frame => (frame as { type: string }).type), [
    "ready", "fact", "checkpoint", "outcome",
  ]);
  assert.equal((frames[3] as { checkpointId: string }).checkpointId, "checkpoint-3");
  await endpoint.close();
  host.destroy();
});

test("one exact Pi generation loads only its synthetic profile/cwd and translates its Timeline", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-exact-pi-"));
  try {
    const cwd = join(root, "project");
    const agentDir = join(root, "profile");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ retry: { enabled: false } }),
    );

    const faux = fauxProvider({
      provider: "pidex-synthetic",
      models: [{ id: "offline" }],
    });
    faux.setResponses([fauxAssistantMessage("synthetic answer")]);
    const syntheticModel = faux.getModel();
    const syntheticRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
    });
    syntheticRuntime.registerProvider(faux.provider.id, {
      name: faux.provider.name,
      api: syntheticModel.api,
      apiKey: "synthetic",
      streamSimple: faux.provider.streamSimple.bind(faux.provider),
      models: [{ ...syntheticModel }],
    });
    const registeredModel = syntheticRuntime.getModel(
      syntheticModel.provider,
      syntheticModel.id,
    );
    assert.ok(registeredModel);

    const timelineEvents: PiTimelineEvent[] = [];
    const child = await ExactPiChild.bind(
      {
        sessionId: "session-110",
        workerId: "worker-110",
        generation: 1,
        cwd,
        agentDir,
      },
      {
        modelRuntime: syntheticRuntime,
        model: registeredModel,
      },
    );

    const result = await child.execute("offline prompt", event => {
      timelineEvents.push(event);
    });
    assert.equal(EXACT_PI_VERSION, "0.80.10");
    assert.equal(result.text, "synthetic answer");
    assert.match(result.checkpoint, /^[a-f0-9]{64}$/);
    assert.equal(
      timelineEvents.every(event => event.type === "assistant.delta"),
      true,
    );
    assert.equal(
      timelineEvents
        .map(event => event.type === "assistant.delta" ? event.text : "")
        .join(""),
      "synthetic answer",
    );
    assert.equal(faux.state.callCount, 1);

    faux.setResponses([fauxAssistantMessage("second answer")]);
    const secondResult = await child.execute("second Run");
    assert.equal(secondResult.text, "second answer");
    assert.equal(faux.state.callCount, 2);
    await child.dispose();
    await assert.rejects(child.execute("after dispose"), /generation-disposed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
