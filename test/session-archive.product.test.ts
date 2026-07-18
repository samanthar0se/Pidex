import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore } from "../packages/host/src/store.js";

test("Archive is exact, quiescent, durable, and preserves complete Session history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidex-archive-"));
  const path = join(dir, "authority.sqlite");
  const adapters = adaptersFor("deterministic");
  try {
    let store = new AuthorityStore(path, adapters);
    const session = store.createSession(null, null, 1).session;
    const run = store.submitRun("device", { commandId: "run", sessionId: session.sessionId, prompt: "history", requiredCapability: "run.submit" }, 2);
    assert.equal(run.kind, "accepted");
    if (run.kind !== "accepted") return;

    const raced = store.changeSessionAvailability("device", { commandId: "archive-busy", sessionId: session.sessionId, observedMetadataRevision: session.metadataRevision }, "archived", 3);
    assert.deepEqual([raced.kind, raced.error], ["rejected", "session-not-quiescent"]);
    store.settleRun(run.run.runId, "completed", "preserved response", null, 4);
    const current = store.projection().sessions[0]!;
    const archived = store.changeSessionAvailability("device", { commandId: "archive", sessionId: session.sessionId, observedMetadataRevision: current.metadataRevision }, "archived", 5);
    assert.equal(archived.kind, "accepted");
    assert.equal(archived.session?.residency, "sleeping");
    assert.equal(store.projection().sessions.length, 0);
    assert.equal(store.projection().archivedSessions.length, 1);
    assert.equal(store.submitRun("device", { commandId: "blocked", sessionId: session.sessionId, prompt: "no", requiredCapability: "run.submit" }, 6).kind, "rejected");
    const history = store.timeline(session.sessionId);
    assert.equal(history.some(entry => entry.kind === "prompt"), true);
    store.close();

    store = new AuthorityStore(path, adapters);
    assert.equal(store.projection().archivedSessions[0]?.sessionId, session.sessionId);
    const stale = store.changeSessionAvailability("other", { commandId: "stale", sessionId: session.sessionId, observedMetadataRevision: current.metadataRevision }, "available", 7);
    assert.equal(stale.error, "stale-precondition");
    const restored = store.changeSessionAvailability("other", { commandId: "restore", sessionId: session.sessionId, observedMetadataRevision: archived.session!.metadataRevision }, "available", 8);
    assert.equal(restored.session?.residency, "sleeping");
    assert.deepEqual(store.timeline(session.sessionId), history);
    store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
