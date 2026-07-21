import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  ExactPiChild,
  PiCheckpointStore,
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
    steer: async () => {},
    stop: async () => {},
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
  assert.deepEqual(
    (frames[0] as { readiness: unknown }).readiness,
    {
      release: "ready",
      session: "ready",
      provider: "unchecked",
    },
  );
  assert.equal((frames[3] as { checkpointId: string }).checkpointId, "checkpoint-3");
  await endpoint.close();
  host.destroy();
});

test("the exact Pi endpoint never settles exported checkpoint bytes without durable publication", async () => {
  const [host, childStream] = duplexPair();
  const identity = {
    sessionId: "session-unpublished",
    workerId: "worker-unpublished",
    generation: 1,
    protocolGeneration: 1,
  } as const;
  const endpoint = new ExactPiWorkerEndpoint(childStream, identity, {
    authenticationToken: "d".repeat(64),
    bind: async () => ({
      binding: { ...identity, cwd: "/canonical", agentDir: "/profile" },
      execute: async () => ({
        text: "must not settle",
        checkpoint: "private-leaf",
        checkpointArtifact: Buffer.from("opaque Pi state"),
      }),
      steer: async () => {},
      stop: async () => {},
      dispose: async () => {},
    }),
    agentDir: "/profile",
  });
  const readiness = readFrames(host, 1);
  host.write(SessionWorkerTransport.frame({
    ...identity,
    type: "bootstrap",
    sequence: 0,
    authenticationToken: "d".repeat(64),
    releaseGeneration: "release-1",
    configGeneration: "config-1",
    piGeneration: EXACT_PI_VERSION,
    cwd: "/canonical",
  }));
  assert.equal(((await readiness)[0] as { type: string }).type, "ready");
  const output = readFrames(host, 1);
  host.write(SessionWorkerTransport.frame({
    ...identity,
    type: "execute",
    sequence: 1,
    correlationId: "run-unpublished",
    prompt: "work",
  }));

  try {
    const frames = await output;
    assert.equal((frames[0] as { type: string }).type, "fault");
    assert.equal(
      (frames[0] as { code: string }).code,
      "checkpoint-publication-unavailable",
    );
  } finally {
    await endpoint.close();
    host.destroy();
  }
});

test("the exact Pi child endpoint applies steering and Stop while a Run is executing", async () => {
  const [host, childStream] = duplexPair();
  const identity = {
    sessionId: "session-controls",
    workerId: "worker-controls",
    generation: 4,
    protocolGeneration: 1,
  } as const;
  let finish: ((result: { text: string; checkpoint: string }) => void) | undefined;
  const controls: string[] = [];
  const endpoint = new ExactPiWorkerEndpoint(childStream, identity, {
    authenticationToken: "b".repeat(64),
    bind: async () => ({
      binding: { ...identity, cwd: "/canonical", agentDir: "/profile" },
      execute: () => new Promise(resolve => { finish = resolve; }),
      steer: async text => { controls.push(`steer:${text}`); },
      stop: async () => { controls.push("stop"); finish?.({ text: "", checkpoint: "cancelled-cp" }); },
      dispose: async () => {},
    }),
    agentDir: "/profile",
  });
  const output = readFrames(host, 3);
  const send = (type: string, sequence: number, body: object) => host.write(
    SessionWorkerTransport.frame({ ...identity, type, sequence, ...body }),
  );
  send("bootstrap", 0, {
    authenticationToken: "b".repeat(64), releaseGeneration: "release-1",
    configGeneration: "config-1", piGeneration: EXACT_PI_VERSION, cwd: "/canonical",
  });
  send("execute", 1, { correlationId: "run-1", prompt: "work" });
  send("steer", 2, { correlationId: "run-1", text: "change course" });
  send("stop", 3, { correlationId: "run-1", reason: "user" });

  const frames = await output;
  assert.deepEqual(controls, ["steer:change course", "stop"]);
  assert.deepEqual(frames.map(frame => (frame as { type: string }).type), [
    "ready", "checkpoint", "outcome",
  ]);
  assert.equal((frames[2] as { outcome: string }).outcome, "cancelled");
  await endpoint.close();
  host.destroy();
});

test("the exact Pi endpoint brokers blocking extension UI and acknowledges application", async () => {
  const [host, childStream] = duplexPair();
  const identity = {
    sessionId: "session-ui", workerId: "worker-ui", generation: 5,
    protocolGeneration: 1,
  } as const;
  let ui: ExtensionUIContext | undefined;
  const endpoint = new ExactPiWorkerEndpoint(childStream, identity, {
    authenticationToken: "c".repeat(64),
    bind: async () => ({
      binding: { ...identity, cwd: "/canonical", agentDir: "/profile" },
      configureUI: value => { ui = value; },
      execute: async () => {
        ui?.notify("Waiting for approval", "info");
        assert.equal(await ui?.confirm("Deploy", "Continue?"), true);
        return { text: "", checkpoint: "ui-cp" };
      },
      steer: async () => {}, stop: async () => {}, dispose: async () => {},
    }),
    agentDir: "/profile",
  });
  const output = readFrames(host, 6);
  const firstOutput = readFrames(host, 3);
  const send = (type: string, sequence: number, body: object) => host.write(
    SessionWorkerTransport.frame({ ...identity, type, sequence, ...body }),
  );
  send("bootstrap", 0, {
    authenticationToken: "c".repeat(64), releaseGeneration: "release-1",
    configGeneration: "config-1", piGeneration: EXACT_PI_VERSION, cwd: "/canonical",
  });
  send("execute", 1, { correlationId: "run-ui", prompt: "deploy" });

  const first = await firstOutput;
  assert.deepEqual(
    (first[0] as { capabilities: Array<{ id: string }> }).capabilities
      .map(capability => capability.id),
    ["run.execute", "input.text", "model.select", "mode.select", "checkpoint.durable", "interaction.basic", "presentation.effects"],
  );
  const request = first[2] as { correlationId: string; interaction: unknown };
  assert.deepEqual(request.interaction, {
    kind: "confirm", message: "Deploy\nContinue?",
  });
  send("interaction.response", 2, {
    correlationId: request.correlationId,
    response: { dismissed: false, value: true },
  });

  const frames = await output;
  assert.deepEqual(frames.map(frame => (frame as { type: string }).type), [
    "ready", "presentation", "interaction.request", "interaction.applied", "checkpoint", "outcome",
  ]);
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

test("durable Pi checkpoints deduplicate chunks and Fork/migration never mutate their source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-pi-checkpoints-"));
  try {
    const store = new PiCheckpointStore({
      chunksDirectory: join(root, "chunks"),
      manifestsDirectory: join(root, "manifests"),
    });
    const source = await store.publish({
      sessionId: "parent",
      sourceCheckpointId: null,
      workerGeneration: 2,
      releaseGeneration: "release-a",
      piGeneration: EXACT_PI_VERSION,
      privateLeafId: "leaf-1",
      privateFormatVersion: 3,
      bytes: Buffer.from("private pi state"),
    });
    const duplicate = await store.publish({
      sessionId: "parent",
      sourceCheckpointId: source.checkpointId,
      workerGeneration: 2,
      releaseGeneration: "release-a",
      piGeneration: EXACT_PI_VERSION,
      privateLeafId: "leaf-2",
      privateFormatVersion: 3,
      bytes: Buffer.from("private pi state"),
    });
    assert.deepEqual(source.chunkIds, duplicate.chunkIds);

    const fork = await store.fork(source.checkpointId, {
      childSessionId: "child",
      workerGeneration: 1,
      releaseGeneration: "release-a",
    });
    const migrated = await store.migrate(source.checkpointId, {
      sessionId: "parent",
      workerGeneration: 3,
      releaseGeneration: "release-b",
      piGeneration: EXACT_PI_VERSION,
      privateFormatVersion: 4,
      convert: bytes => Buffer.concat([bytes, Buffer.from(" migrated")]),
    });

    assert.equal((await store.read(source.checkpointId)).toString(), "private pi state");
    assert.equal((await store.read(fork.checkpointId)).toString(), "private pi state");
    assert.equal((await store.read(migrated.checkpointId)).toString(), "private pi state migrated");
    assert.notEqual(fork.checkpointId, source.checkpointId);
    assert.notEqual(migrated.checkpointId, source.checkpointId);
    const sourceManifest = JSON.parse(await readFile(
      join(root, "manifests", `${source.checkpointId}.json`), "utf8",
    ));
    assert.equal(sourceManifest.sessionId, "parent");
    assert.equal(sourceManifest.publicationState, "published");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
