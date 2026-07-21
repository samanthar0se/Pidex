import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import {
  adaptersFor,
  type PiAdapter,
} from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { AuthorityStore } from "../packages/host/src/store.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

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
    const first = store.submitRun(
      "d",
      {
        commandId: "one",
        sessionId: parent.sessionId,
        prompt: "one",
        requiredCapability: "run.submit",
      },
      2,
    );
    assert.equal(first.kind, "accepted");
    if (first.kind !== "accepted") {
      throw new Error("run not accepted");
    }
    store.completeRun(first.run.runId, "answer", "stable", 3);
    const point = store.timeline(parent.sessionId).at(-1);
    assert.ok(point);
    const active = store.submitRun(
      "d",
      {
        commandId: "two",
        sessionId: parent.sessionId,
        prompt: "still running",
        requiredCapability: "run.submit",
      },
      4,
    );
    assert.equal(active.kind, "accepted");

    const child = store.forkSession(
      parent.sessionId,
      point.entryId,
      undefined,
      undefined,
      "session_child",
      "stable",
      "stable-child-genesis",
      5,
    ).session;
    assert.equal(child.parentSessionId, parent.sessionId);
    assert.equal(child.forkPointEntryId, point.entryId);
    assert.equal(child.residency, "sleeping");
    assert.deepEqual([child.projectId, child.workspaceId], ["p", "w"]);
    assert.deepEqual(
      store.timeline(child.sessionId).map(entry => entry.text),
      ["one", "answer"],
    );
    assert.equal(
      store
        .acceptedRunsForSession(child.sessionId)
        .every(run => run.state === "completed"),
      true,
    );
    assert.equal(store.timeline(parent.sessionId).at(-1)?.text, "still running");
    const openStore = store;
    assert.throws(
      () =>
        openStore.forkSession(
          parent.sessionId,
          point.entryId,
          "missing",
          null,
          "session_bad",
          "stable",
          "stable-child-genesis-2",
          6,
        ),
      /unknown-project/,
    );
    assert.throws(
      () =>
        openStore.forkSession(
          parent.sessionId,
          point.entryId,
          undefined,
          undefined,
          "session_bad2",
          "wrong-runtime-proof",
          "stable-child-genesis-3",
          6,
        ),
      /invalid-fork-point/,
    );

    const childRun = store.submitRun(
      "d",
      {
        commandId: "child-run",
        sessionId: child.sessionId,
        prompt: "independent",
        requiredCapability: "run.submit",
      },
      7,
    );
    assert.equal(childRun.kind, "accepted");
    store.close();
    store = undefined;
    store = new AuthorityStore(path, adapters, catalog);
    const recovered = store
      .projection()
      .sessions.find(item => item.sessionId === child.sessionId);
    assert.ok(recovered);
    assert.equal(recovered.parentSessionId, parent.sessionId);
    assert.equal(store.timeline(child.sessionId).length, 3);
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fork command publishes validated child genesis and closes its bootstrap on publication or commit failure", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-fork-command-"));
  const baseAdapters = adaptersFor("deterministic");
  let forkRequest:
    | {
        parentSessionId: string;
        checkpoint: string;
        childSessionId: string;
      }
    | undefined;
  const bootstrapLifecycle: string[] = [];
  let forkFailure: "publication" | null = null;
  const pi: PiAdapter = {
    ...baseAdapters.pi,
    forkCheckpoint: async (
      parentSessionId,
      checkpoint,
      childSessionId,
    ) => {
      forkRequest = { parentSessionId, checkpoint, childSessionId };
      bootstrapLifecycle.push("bootstrap");
      return {
        publish: async () => {
          bootstrapLifecycle.push("publish", "validate");
          if (forkFailure === "publication") throw new Error("publication-interrupted");
          return "sha256:" + "a".repeat(64);
        },
        close: async () => { bootstrapLifecycle.push("close"); },
      };
    },
  };
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters: { ...baseAdapters, pi },
  });
  const socket = new WebSocket(
    `${host.origin.replace("https:", "wss:")}/control`,
    {
      rejectUnauthorized: false,
      headers: { authorization: "Bearer device" },
    },
  );

  try {
    await negotiateControl(socket);
    socket.send(
      JSON.stringify({ type: "session.create", commandId: "create" }),
    );
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") {
      throw new Error("session not created");
    }
    const parentSessionId = created.changes[0]?.session?.sessionId;
    assert.ok(parentSessionId);

    socket.send(
      JSON.stringify({
        type: "run.submit",
        commandId: "run",
        sessionId: parentSessionId,
        prompt: "create checkpoint",
        requiredCapability: "run.submit",
      }),
    );
    await nextControlMessage(socket);
    const readStateChanged = await nextControlMessage(socket);
    assert.equal(readStateChanged.type, "host.change-set");
    if (readStateChanged.type === "host.change-set") {
      assert.equal(
        readStateChanged.changes[0]?.type,
        "session.read-state-changed",
      );
    }
    const completed = await nextControlMessage(socket);
    assert.equal(completed.type, "run.completed");
    if (completed.type !== "run.completed") {
      throw new Error("run not completed");
    }
    const forkPointEntryId = completed.timeline.at(-1)?.entryId;
    assert.ok(forkPointEntryId);

    async function expectForkRejected(commandId: string): Promise<void> {
      socket.send(JSON.stringify({
        type: "session.fork",
        commandId,
        parentSessionId,
        forkPointEntryId,
      }));
      const failure = await nextControlMessage(socket);
      assert.equal(
        failure.type === "command.outcome" && failure.outcome,
        "rejected",
      );
      assert.equal(bootstrapLifecycle.at(-1), "close");
    }

    socket.send(
      JSON.stringify({
        type: "session.fork",
        commandId: "fork",
        parentSessionId,
        forkPointEntryId,
      }),
    );
    const outcome = await nextControlMessage(socket);
    assert.equal(
      outcome.type === "command.outcome" && outcome.outcome,
      "accepted",
    );
    const forked = await nextControlMessage(socket);
    assert.equal(forked.type, "host.change-set");
    if (forked.type !== "host.change-set") {
      throw new Error("fork not published");
    }
    const forkChange = forked.changes[0];
    assert.equal(forkChange?.type, "session.forked");
    if (forkChange?.type !== "session.forked") {
      throw new Error("fork change not published");
    }
    const child = forkChange.session;
    assert.deepEqual(
      [child.parentSessionId, child.forkPointEntryId],
      [parentSessionId, forkPointEntryId],
    );
    assert.deepEqual(forkRequest, {
      parentSessionId,
      checkpoint: `checkpoint:${parentSessionId}`,
      childSessionId: child.sessionId,
    });
    assert.deepEqual(bootstrapLifecycle, [
      "bootstrap", "publish", "validate", "close",
    ]);
    const childStore = new AuthorityStore(
      join(dataDir, "authority.sqlite"),
      baseAdapters,
    );
    assert.equal(
      childStore.latestCheckpoint(child.sessionId),
      "sha256:" + "a".repeat(64),
    );
    assert.equal(
      childStore.latestCheckpoint(parentSessionId),
      `checkpoint:${parentSessionId}`,
    );
    childStore.close();

    forkFailure = "publication";
    await expectForkRejected("fork-publication-failure");

    forkFailure = null;
    baseAdapters.storage.beforeCommit = () => { throw new Error("commit-interrupted"); };
    await expectForkRejected("fork-commit-failure");

    const afterFailures = new AuthorityStore(
      join(dataDir, "authority.sqlite"), adaptersFor("deterministic"),
    );
    assert.equal(afterFailures.projection().sessions.length, 2);
    assert.equal(
      afterFailures.latestCheckpoint(parentSessionId),
      `checkpoint:${parentSessionId}`,
    );
    afterFailures.close();
  } finally {
    socket.close();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
