import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore } from "../packages/host/src/store.js";
import { PiCheckpointPublisher } from "../packages/durability/src/pi-checkpoints.js";
import {
  createDeterministicPublicationAdapter,
  type PublicationStep,
} from "../packages/durability/src/index.js";

test("checkpoint chunks and manifest publish before atomic Run settlement", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-checkpoint-settlement-"));
  try {
    const store = new AuthorityStore(
      join(dataDir, "authority.sqlite"),
      adaptersFor("deterministic"),
    );
    const session = store.createSession(null, null, 1).session;
    const accepted = store.submitRun(
      "device",
      {
        commandId: "run",
        sessionId: session.sessionId,
        prompt: "hello",
        requiredCapability: "run.submit",
      },
      2,
    );
    assert.equal(accepted.kind, "accepted");
    if (accepted.kind !== "accepted") throw new Error("expected acceptance");

    const settled = store.settleRunWithCheckpoint(
      accepted.run.runId,
      "completed",
      "done",
      {
        sessionId: session.sessionId,
        sourceCheckpoint: "private-jsonl-leaf-17",
        workerGeneration: "worker-4",
        releaseGeneration: "release-2",
        piGeneration: "pi-0.80.10",
        chunks: [Buffer.from("private pi bytes"), Buffer.from("more bytes")],
      },
      3,
    );

    const checkpointId = store.latestCheckpoint(session.sessionId);
    assert.match(checkpointId ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(checkpointId, "private-jsonl-leaf-17");
    const digest = checkpointId!.slice("sha256:".length);
    const manifestPath = join(dataDir, "checkpoints", "manifests", digest);
    assert.equal(existsSync(manifestPath), true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.sessionId, session.sessionId);
    assert.equal(manifest.sourceCheckpoint, "private-jsonl-leaf-17");
    assert.equal(manifest.publicationState, "published");
    assert.equal(manifest.chunks.length, 2);
    for (const chunk of manifest.chunks) {
      assert.equal(
        existsSync(join(dataDir, "checkpoints", "chunks", chunk.sha256)),
        true,
      );
    }
    store.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("every checkpoint publication cut withholds identity while retaining any published bytes", async () => {
  const cuts: PublicationStep[] = [
    "stage-created", "materialized", "validated-before-publication",
    "regular-files-flushed", "writers-closed", "published",
    "validated-after-publication", "parent-directory-flushed",
  ];
  for (const cut of cuts) {
    const root = await mkdtemp(join(tmpdir(), `pidex-checkpoint-${cut}-`));
    try {
      const publisher = new PiCheckpointPublisher(root,
        createDeterministicPublicationAdapter({ failAt: cut }));
      assert.throws(() => publisher.publish({
        sessionId: "session-1",
        sourceCheckpoint: "private-leaf",
        workerGeneration: "worker-1",
        releaseGeneration: "release-1",
        piGeneration: "pi-0.80.10",
        chunks: [Buffer.from("uncertain bytes")],
      }), /Injected publication failure/);
      // Publication may have crossed rename, but no opaque identity was returned
      // and the bytes are retained for conservative reconciliation.
      if (cut === "published" || cut === "validated-after-publication" || cut === "parent-directory-flushed") {
        assert.equal(existsSync(join(root, "chunks")), true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("an uncertain Host transaction preserves the prior checkpoint and never replays accepted work", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-checkpoint-uncertain-"));
  const databasePath = join(dataDir, "authority.sqlite");
  try {
    const adapters = adaptersFor("deterministic");
    const store = new AuthorityStore(databasePath, adapters);
    const session = store.createSession(null, null, 1).session;
    const first = store.submitRun("device", {
      commandId: "first", sessionId: session.sessionId, prompt: "one", requiredCapability: "run.submit",
    }, 2);
    if (first.kind !== "accepted") throw new Error("expected acceptance");
    store.settleRun(first.run.runId, "completed", "one", "sha256:" + "1".repeat(64), 3);

    const second = store.submitRun("device", {
      commandId: "second", sessionId: session.sessionId, prompt: "two", requiredCapability: "run.submit",
    }, 4);
    if (second.kind !== "accepted") throw new Error("expected acceptance");
    adapters.storage.beforeCommit = () => { throw new Error("uncertain-commit"); };
    assert.throws(() => store.settleRunWithCheckpoint(second.run.runId, "completed", "two", {
      sessionId: session.sessionId,
      sourceCheckpoint: "private-leaf-2",
      workerGeneration: "worker-2",
      releaseGeneration: "release-2",
      piGeneration: "pi-0.80.10",
      chunks: [Buffer.from("retained uncertain bytes")],
    }, 5), /uncertain-commit/);

    assert.equal(store.latestCheckpoint(session.sessionId), "sha256:" + "1".repeat(64));
    assert.equal(store.runs(session.sessionId).at(-1)?.state, "executing");
    assert.equal(existsSync(join(dataDir, "checkpoints", "manifests")), true);
    store.close();

    const recovered = new AuthorityStore(databasePath, adaptersFor("deterministic"));
    recovered.reconcileAcceptedRuns(6);
    assert.equal(recovered.runs(session.sessionId).at(-1)?.state, "interrupted");
    assert.equal(recovered.latestCheckpoint(session.sessionId), "sha256:" + "1".repeat(64));
    recovered.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
