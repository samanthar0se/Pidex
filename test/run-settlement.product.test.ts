import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore } from "../packages/host/src/store.js";

test("an accepted Run is settled exactly once and references a published immutable payload", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-settlement-"));
  const adapters = adaptersFor("deterministic");
  try {
    const store = new AuthorityStore(join(dataDir, "authority.sqlite"), adapters);
    const session = store.createSession(null, null, 1).session;
    const accepted = store.submitRun("device", {
      commandId: "run",
      sessionId: session.sessionId,
      prompt: "hello",
      requiredCapability: "run.submit",
    }, 2);
    assert.equal(accepted.kind, "accepted");
    if (accepted.kind !== "accepted") throw new Error("expected acceptance");

    const settled = store.settleRun(accepted.run.runId, "failed", "model unavailable", null, 3);
    assert.equal(settled.run.state, "failed");
    const outcome = settled.timeline.at(-1);
    assert.equal(outcome?.kind, "outcome");
    assert.ok(outcome?.blobId);
    assert.equal(existsSync(join(dataDir, "blobs", outcome!.blobId!.slice(7))), true);
    assert.equal(readdirSync(join(dataDir, "blobs")).some(name => name.endsWith(".stage")), false);
    assert.throws(() => store.settleRun(accepted.run.runId, "interrupted", "again", null, 4), /run-not-accepted/);

    const second = store.submitRun("device", {
      commandId: "run-2", sessionId: session.sessionId, prompt: "recover", requiredCapability: "run.submit",
    }, 5);
    assert.equal(second.kind, "accepted");
    if (second.kind !== "accepted") throw new Error("expected acceptance");
    // Simulate loss after durable Pi proof but before blob/SQLite settlement.
    store.stageCompletionEvidence(second.run.runId, "proved response", "checkpoint-2");
    store.close();

    const recovered = new AuthorityStore(join(dataDir, "authority.sqlite"), adapters);
    recovered.reconcileAcceptedRuns(6);
    assert.equal(recovered.timeline(session.sessionId).at(-1)?.text, "proved response");
    assert.equal(recovered.acceptedRuns().length, 0);
    recovered.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
