import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore } from "../packages/host/src/store.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const SYNCHRONIZATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

test("maintenance rejects cursors whose synchronization history was compacted", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-maintenance-"));
  const path = join(root, "authority.sqlite");
  let store: AuthorityStore | undefined;
  try {
    store = new AuthorityStore(path, adaptersFor("deterministic"));
    const cursorBeforeChange = store.status("").synchronization.cursor;
    store.createSession(null, null, 1);

    const result = store.runMaintenance(SYNCHRONIZATION_RETENTION_MS + 2);

    assert.equal(result.changesCompacted, 1);
    assert.deepEqual(store.cursorBasis(cursorBeforeChange), {
      compatible: false,
      reason: "history-unavailable",
    });
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("maintenance retains reachable ancestry and uses durable independent proofs for orphan cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-maintenance-"));
  const path = join(root, "authority.sqlite");
  let store: AuthorityStore | undefined;
  try {
    store = new AuthorityStore(path, adaptersFor("deterministic"));
    const parent = store.createSession(null, null, 1).session;
    const accepted = store.submitRun(
      "device",
      {
        commandId: "run",
        sessionId: parent.sessionId,
        prompt: "hello",
        requiredCapability: "run.submit",
      },
      2,
    );
    assert.equal(accepted.kind, "accepted");
    if (accepted.kind !== "accepted") {
      throw new Error("not accepted");
    }
    store.completeRun(accepted.run.runId, "reachable", "checkpoint", 3);
    const point = store.timeline(parent.sessionId).at(-1);
    assert.ok(point);
    assert.ok(point.blobId);
    store.forkSession(
      parent.sessionId,
      point.entryId,
      undefined,
      undefined,
      "child",
      "checkpoint",
      "checkpoint-child-genesis",
      4,
    );

    const orphanDigest = digest("orphan");
    await writeFile(join(root, "blobs", orphanDigest), "orphan");
    const racedDigest = digest("raced");
    await writeFile(join(root, "blobs", racedDigest), "raced");
    const protectedDigest = digest("snapshot");
    await writeFile(join(root, "blobs", protectedDigest), "snapshot");
    store.retainObjectReference(
      "recovery-manifest",
      "snapshot-1",
      `sha256:${protectedDigest}`,
    );

    const outside = join(root, "outside");
    await mkdir(outside);
    const sentinel = join(outside, "sentinel");
    await writeFile(sentinel, "safe");
    await symlink(sentinel, join(root, "blobs", digest("escape")));

    const first = store.runMaintenance(10);
    assert.deepEqual(
      first.quarantined.sort(),
      [`sha256:${orphanDigest}`, `sha256:${racedDigest}`].sort(),
    );
    // A manifest published after the first proof wins over collection.
    store.retainObjectReference(
      "rollback",
      "generation-1",
      `sha256:${racedDigest}`,
    );
    assert.equal(store.readReferencedBlob(point.blobId)?.toString(), "reachable");
    assert.equal(await readFile(sentinel, "utf8"), "safe");
    store.close();
    store = undefined;

    store = new AuthorityStore(path, adaptersFor("deterministic"));
    const second = store.runMaintenance(11);
    assert.deepEqual(second.deleted, [`sha256:${orphanDigest}`]);
    assert.deepEqual(second.restored, [`sha256:${racedDigest}`]);
    assert.equal(
      await readFile(join(root, "blobs", racedDigest), "utf8"),
      "raced",
    );
    const sessionIds = new Set(
      store.projection().sessions.map((session) => session.sessionId),
    );
    assert.ok(sessionIds.has(parent.sessionId));
    assert.ok(sessionIds.has("child"));
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
