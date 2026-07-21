import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ExactPiChild, EXACT_PI_VERSION } from "../packages/pi-worker/src/index.js";

test("one exact Pi generation loads only its synthetic profile/cwd and translates its Timeline", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-exact-pi-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "profile");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ retry: { enabled: false } }),
  );

  const faux = fauxProvider({ provider: "pidex-synthetic", models: [{ id: "offline" }] });
  faux.setResponses([fauxAssistantMessage("synthetic answer")]);
  const models = createModels();
  models.setProvider(faux.provider);
  const syntheticRuntime = Object.assign(models, {
    hasConfiguredAuth: () => true,
    getCompatibilityRequestConfig: () => ({}),
  });
  const facts: unknown[] = [];
  const child = await ExactPiChild.bind(
    { sessionId: "session-110", workerId: "worker-110", generation: 1, cwd, agentDir },
    { modelRuntime: syntheticRuntime as unknown as ModelRuntime, model: faux.getModel() },
  );

  const result = await child.execute("offline prompt", fact => facts.push(fact));
  assert.equal(EXACT_PI_VERSION, "0.80.10");
  assert.equal(result.text, "synthetic answer");
  assert.match(result.checkpoint, /^[a-f0-9]{64}$/);
  assert.deepEqual(facts, [{ type: "assistant.delta", text: "synthetic answer" }]);
  assert.equal(faux.state.callCount, 1);
  await assert.rejects(child.execute("second Run"), /already-executed/);
});
