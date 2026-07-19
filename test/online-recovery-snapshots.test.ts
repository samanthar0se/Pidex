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

function input(id: string, object = "shared"): OnlineSnapshotInput {
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

test("online snapshots close only after objects and remain immutable", () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-snapshots-"));
  try {
    const events: string[] = [];
    const store = new OnlineSnapshotStore(root, event => events.push(event));
    const snapshot = store.create(input("new"));

    assert.deepEqual(store.listSelectable().map(value => value.snapshotId), ["new"]);
    assert.ok(events.indexOf("object-published") < events.indexOf("snapshot-closed"));
    const original = readFileSync(join(snapshot.path, "manifest.json"), "utf8");
    store.verify("new");
    assert.equal(readFileSync(join(snapshot.path, "manifest.json"), "utf8"), original);
    assert.ok(existsSync(join(root, "verification", "new.json")));

    writeFileSync(join(snapshot.path, "database.sqlite"), "damage");
    assert.deepEqual(store.listSelectable(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rotation retains protected points and objects reached by retained snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-snapshots-"));
  try {
    const store = new OnlineSnapshotStore(root);
    store.create({ ...input("old", "old-object"), protected: true });
    store.create(input("new", "new-object"));
    const before = store.listSelectable();
    const protectedObject = before.find(item => item.snapshotId === "old")!.manifest.objects[0]!.digest;

    store.rotate({ scheduledRetention: 0 });
    assert.deepEqual(store.listSelectable().map(value => value.snapshotId), ["old"]);
    assert.ok(existsSync(join(root, "objects", protectedObject.replace("sha256:", ""))));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
