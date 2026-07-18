import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore } from "../packages/host/src/store.js";

test("Host restart conservatively converges all Sessions without rotating continuity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-host-loss-"));
  const path = join(root, "authority.sqlite");
  const adapters = adaptersFor("deterministic");
  try {
    let store = new AuthorityStore(path, adapters);
    const initialStatus = store.status("test");
    const first = store.createSession(null, null, 1).session;
    const second = store.createSession(null, null, 2).session;
    const uncertain = store.submitRun("device", {
      commandId: "uncertain", sessionId: first.sessionId, prompt: "one",
      requiredCapability: "run.submit",
    }, 3);
    assert.equal(uncertain.kind, "accepted");
    const proved = store.submitRun("device", {
      commandId: "proved", sessionId: second.sessionId, prompt: "two",
      requiredCapability: "run.submit",
    }, 4);
    assert.equal(proved.kind, "accepted");
    if (proved.kind !== "accepted") throw new Error("missing run");
    store.stageCompletionEvidence(proved.run.runId, "durable result", "checkpoint");
    store.close(); // simulated power loss boundary after durable writes

    store = new AuthorityStore(path, adapters);
    store.reconcileAcceptedRuns(5);
    assert.equal(store.runs(first.sessionId)[0]?.state, "interrupted");
    assert.equal(store.runs(second.sessionId)[0]?.state, "completed");
    assert.equal(store.timeline(second.sessionId).at(-1)?.text, "durable result");
    assert.equal(store.status("test").hostId, initialStatus.hostId);
    assert.equal(store.status("test").synchronization.epoch, initialStatus.synchronization.epoch);
    assert.equal(store.acceptedRuns().length, 0);
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
