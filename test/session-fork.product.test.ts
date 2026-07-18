import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore } from "../packages/host/src/store.js";

test("forks stable history into an inert, independently scoped child with durable ancestry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidex-fork-"));
  const path = join(dir, "authority.sqlite");
  const adapters = adaptersFor("deterministic");
  const catalog = {
    projects: [{ projectId: "p", name: "Project" }],
    workspaces: [{ workspaceId: "w", projectId: "p", name: "Workspace" }],
  };
  let store: AuthorityStore | undefined;
  try {
    store = new AuthorityStore(path, adapters, catalog);
    const parent = store.createSession("p", "w", 1).session;
    const first = store.submitRun("d", { commandId: "one", sessionId: parent.sessionId,
      prompt: "one", requiredCapability: "run.submit" }, 2);
    assert.equal(first.kind, "accepted");
    if (first.kind !== "accepted") return;
    store.completeRun(first.run.runId, "answer", "stable", 3);
    const point = store.timeline(parent.sessionId).at(-1)!;
    const active = store.submitRun("d", { commandId: "two", sessionId: parent.sessionId,
      prompt: "still running", requiredCapability: "run.submit" }, 4);
    assert.equal(active.kind, "accepted");

    const child = store.forkSession(parent.sessionId, point.entryId, undefined, undefined,
      "session_child", "stable", 5).session;
    assert.equal(child.parentSessionId, parent.sessionId);
    assert.equal(child.forkPointEntryId, point.entryId);
    assert.equal(child.residency, "sleeping");
    assert.deepEqual([child.projectId, child.workspaceId], ["p", "w"]);
    assert.deepEqual(store.timeline(child.sessionId).map(e => e.text), ["one", "answer"]);
    assert.equal(store.acceptedRunsForSession(child.sessionId).every(r => r.state === "completed"), true);
    assert.equal(store.timeline(parent.sessionId).at(-1)?.text, "still running");
    assert.throws(() => store!.forkSession(parent.sessionId, point.entryId, "missing", null,
      "session_bad", "stable", 6), /unknown-project/);
    assert.throws(() => store!.forkSession(parent.sessionId, point.entryId, undefined, undefined,
      "session_bad2", "wrong-runtime-proof", 6), /invalid-fork-point/);

    const childRun = store.submitRun("d", { commandId: "child-run", sessionId: child.sessionId,
      prompt: "independent", requiredCapability: "run.submit" }, 7);
    assert.equal(childRun.kind, "accepted");
    store.close(); store = undefined;
    store = new AuthorityStore(path, adapters, catalog);
    const recovered = store.projection().sessions.find(item => item.sessionId === child.sessionId)!;
    assert.equal(recovered.parentSessionId, parent.sessionId);
    assert.equal(store.timeline(child.sessionId).length, 3);
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
