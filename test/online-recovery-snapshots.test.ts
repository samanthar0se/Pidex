import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OnlineSnapshotStore,
  type OnlineSnapshotInput,
} from "../packages/host/src/recovery-snapshots.js";

function withFixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "pidex-snapshots-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function snapshotInput(id: string, object = "shared"): OnlineSnapshotInput {
  return {
    snapshotId: id,
    createdAt: id === "old" ? 1 : 2,
    kind: "scheduled",
    protected: false,
    barrier: `barrier-${id}`,
    database: Buffer.from(`database-${id}`),
    objects: [{ bytes: Buffer.from(object) }],
    checkpoints: [{ sessionId: "session-1", checkpoint: "cp-1" }],
    compatibility: { snapshotFormat: 1, schemaVersion: 1, release: ">=0.1" },
  };
}

test("online snapshots close only after objects and remain immutable", () =>
  withFixture(root => {
    const events: string[] = [];
    const store = new OnlineSnapshotStore(root, event => events.push(event));
    const snapshot = store.create(snapshotInput("new"));

    assert.deepEqual(
      store.listSelectable().map(value => value.snapshotId),
      ["new"],
    );
    assert.ok(
      events.indexOf("object-published") < events.indexOf("snapshot-closed"),
    );
    const original = readFileSync(join(snapshot.path, "manifest.json"), "utf8");
    store.verify("new");
    assert.equal(
      readFileSync(join(snapshot.path, "manifest.json"), "utf8"),
      original,
    );
    assert.ok(existsSync(join(root, "verification", "new.json")));

    writeFileSync(join(snapshot.path, "database.sqlite"), "damage");
    assert.deepEqual(store.listSelectable(), []);
  }));

test("rotation retains protected points and objects reached by retained snapshots", () =>
  withFixture(root => {
    const store = new OnlineSnapshotStore(root);
    store.create({
      ...snapshotInput("old", "old-object"),
      protected: true,
    });
    store.create(snapshotInput("new", "new-object"));
    const snapshotsBeforeRotation = store.listSelectable();
    const protectedSnapshot = snapshotsBeforeRotation.find(
      item => item.snapshotId === "old",
    );
    assert.ok(protectedSnapshot);
    const protectedObject = protectedSnapshot.manifest.objects[0]?.digest;
    assert.ok(protectedObject);

    store.rotate({ scheduledRetention: 0 });
    assert.deepEqual(
      store.listSelectable().map(value => value.snapshotId),
      ["old"],
    );
    assert.ok(
      existsSync(
        join(root, "objects", protectedObject.replace("sha256:", "")),
      ),
    );
  }));
