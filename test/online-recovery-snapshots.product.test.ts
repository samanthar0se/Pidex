import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { OnlineRecoverySnapshots } from "../packages/host/src/recovery-snapshots.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pidex-recovery-"));
  await mkdir(join(root, "live", "blobs"), { recursive: true });
  await writeFile(join(root, "live", "blobs", "shared"), "immutable bytes");
  const database = join(root, "live", "authority.sqlite");
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE host(sequence INTEGER); INSERT INTO host VALUES (4);
    CREATE TABLE runs(run_id TEXT, state TEXT); INSERT INTO runs VALUES ('active', 'executing');`);
  db.close();
  const manager = new OnlineRecoverySnapshots({ root, database });
  return { root, manager };
}

test("changed-day scheduling skips unchanged authority and catches up after healthy startup", async () => {
  const { root, manager } = await fixture();
  try {
    assert.equal(await manager.runScheduled({ now: 0, change: 4, healthySince: 0 }), null);
    const first = await manager.runScheduled({ now: 86_400_000, change: 5, healthySince: 86_400_000 });
    assert.equal(first?.kind, "scheduled");
    assert.equal(await manager.runScheduled({ now: 2 * 86_400_000, change: 5, healthySince: 0 }), null);
    assert.ok(await manager.runScheduled({ now: 3 * 86_400_000, change: 6, healthySince: 3 * 86_400_000 }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshots copy a coherent barrier, independent deduplicated objects, and interruption semantics", async () => {
  const { root, manager } = await fixture();
  try {
    const request = { now: 10, barrier: "host:epoch:4", change: 4, objects: [{ path: "blobs/shared", livePath: join(root, "live", "blobs", "shared") }], checkpoints: [{ sessionId: "s1", checkpoint: "verified-3" }] };
    const one = await manager.create({ ...request, kind: "manual", reason: "Before experiment" });
    const two = await manager.create({ ...request, now: 11, kind: "risk-boundary", reason: "upgrade:0.2" });
    assert.equal(one.restore.executingRuns, "interrupted");
    assert.deepEqual(one.checkpoints, request.checkpoints);
    assert.equal(two.objects[0]?.digest, one.objects[0]?.digest);
    assert.equal((await manager.status()).storageBytes, Buffer.byteLength("immutable bytes"));
    await writeFile(join(root, "live", "blobs", "shared"), "damaged live copy");
    assert.equal(await readFile(join(root, "recovery", "objects", one.objects[0]!.digest), "utf8"), "immutable bytes");
    assert.equal((await stat(join(root, "recovery", "objects", one.objects[0]!.digest))).nlink, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rotation preserves seven daily points and protected manual/upgrade points; verification reports corruption", async () => {
  const { root, manager } = await fixture();
  try {
    const object = [{ path: "blob", livePath: join(root, "live", "blobs", "shared") }];
    for (let day = 1; day <= 9; day++) await manager.create({ kind: "scheduled", now: day * 86_400_000, barrier: `b${day}`, change: day, objects: object, checkpoints: [] });
    const manual = await manager.create({ kind: "manual", reason: "mine", now: 10 * 86_400_000, barrier: "manual", change: 10, objects: object, checkpoints: [] });
    const upgrade = await manager.create({ kind: "risk-boundary", reason: "upgrade", now: 11 * 86_400_000, barrier: "upgrade", change: 11, objects: object, checkpoints: [] });
    let status = await manager.status();
    assert.equal(status.snapshots.filter(point => point.kind === "scheduled").length, 7);
    assert.ok(status.snapshots.some(point => point.id === manual.id && point.protectedReason === "mine"));
    assert.ok(status.snapshots.some(point => point.id === upgrade.id && point.protectedReason === "upgrade"));
    await writeFile(join(root, "recovery", "objects", manual.objects[0]!.digest), "corrupt");
    assert.equal((await manager.verify(manual.id)).verification, "corrupt");
    await manager.delete(manual.id);
    assert.ok(!(await manager.status()).snapshots.some(point => point.id === manual.id));
  } finally { await rm(root, { recursive: true, force: true }); }
});
