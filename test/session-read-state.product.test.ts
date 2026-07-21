import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore, type MarkReadCommand } from "../packages/host/src/store.js";

const basis = [{ id: "session.read-state", version: 1 }] as const;

test("Session authority persists milestones and serializes Device-scoped max mark-read transitions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidex-read-authority-"));
  const path = join(dir, "authority.sqlite");
  let store = new AuthorityStore(path, adaptersFor("deterministic"));
  try {
    const session = store.createSession(null, null, 1).session;
    assert.deepEqual(session.readState, {
      readThroughTimelineRevision: 1, readStatus: "read", readStateRevision: 1,
    });
    const submitted = store.submitRun("device-a", {
      commandId: "run", sessionId: session.sessionId, prompt: "hello",
      requiredCapability: "run.submit",
    }, 2);
    assert.equal(submitted.kind, "accepted");
    if (submitted.kind !== "accepted") throw new Error("run not accepted");
    store.completeRun(submitted.run.runId, "done", "checkpoint", 3);
    const unread = store.projection().sessions[0]!;
    assert.deepEqual(unread.readState, {
      readThroughTimelineRevision: 1, readStatus: "unread", readStateRevision: 2,
    });

    const command: MarkReadCommand = {
      commandId: "mark", sessionId: session.sessionId,
      presentedTimelineRevision: unread.timelineRevision, requiredCapabilityBasis: basis,
    };
    const accepted = store.markSessionRead("device-a", command, 4);
    assert.equal(accepted.kind, "accepted");
    assert.equal("effect" in accepted && accepted.effect, "advanced");
    const replay = store.markSessionRead("device-a", command, 5);
    assert.equal(replay.kind, "replayed");
    const independent = store.markSessionRead("device-b", command, 6);
    assert.equal(independent.kind, "accepted");
    assert.equal("effect" in independent && independent.effect, "no-op");
    const conflict = store.markSessionRead("device-a", {
      ...command, presentedTimelineRevision: 1,
    }, 7);
    assert.deepEqual([conflict.kind, "error" in conflict && conflict.error], ["rejected", "command-id-conflict"]);

    store.close();
    store = new AuthorityStore(path, adaptersFor("deterministic"));
    assert.deepEqual(store.projection().sessions[0]!.readState, {
      readThroughTimelineRevision: unread.timelineRevision,
      readStatus: "read", readStateRevision: 3,
    });
    const invalid = store.markSessionRead("device-a", {
      ...command, commandId: "ahead", presentedTimelineRevision: unread.timelineRevision + 1,
    }, 8);
    assert.deepEqual([invalid.kind, "error" in invalid && invalid.error], ["rejected", "invalid-revision"]);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
