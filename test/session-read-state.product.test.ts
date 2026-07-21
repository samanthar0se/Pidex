import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { AuthorityStore, type MarkReadCommand } from "../packages/host/src/store.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

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
      ...command,
      commandId: "ahead",
      presentedTimelineRevision: unread.timelineRevision + 1,
    }, 8);
    assert.deepEqual(
      [invalid.kind, "error" in invalid && invalid.error],
      ["rejected", "invalid-revision"],
    );
    const zero = store.markSessionRead("device-a", {
      ...command,
      commandId: "zero",
      presentedTimelineRevision: 0,
    }, 9);
    assert.deepEqual(
      [zero.kind, "error" in zero && zero.error],
      ["rejected", "invalid-revision"],
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("replaying a rejected mark-read preserves the authoritative rejection", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-mark-read-rejection-"));
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device-a",
    adapters: adaptersFor("deterministic"),
  });
  const client = new WebSocket(
    `${host.origin.replace("https:", "wss:")}/control`,
    {
      rejectUnauthorized: false,
      headers: { authorization: "Bearer device-a" },
    },
  );
  try {
    await negotiateControl(client);
    const command = {
      type: "session.mark-read",
      commandId: "missing-session",
      sessionId: "session_missing",
      presentedTimelineRevision: 1,
      requiredCapabilityBasis: basis,
    };
    client.send(JSON.stringify(command));
    const rejected = await nextControlMessage(client);
    assert.equal(rejected.type, "command.outcome");
    assert.equal(
      rejected.type === "command.outcome" && rejected.outcome,
      "rejected",
    );
    assert.equal(
      rejected.type === "command.outcome" && rejected.error,
      "unknown-session",
    );

    client.send(JSON.stringify(command));
    assert.deepEqual(await nextControlMessage(client), rejected);
  } finally {
    client.close();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
