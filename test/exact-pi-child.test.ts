import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiTimelineEvent } from "../packages/adapters/src/index.js";
import { ExactPiChild, EXACT_PI_VERSION } from "../packages/pi-worker/src/index.js";

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
    await assert.rejects(child.execute("second Run"), /already-executed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
