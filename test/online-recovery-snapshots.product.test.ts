import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { OnlineRecoverySnapshots } from "../packages/host/src/recovery-snapshots.js";

const DAY_IN_MILLISECONDS = 86_400_000;

async function createRecoveryFixture() {
  const root = await mkdtemp(join(tmpdir(), "pidex-recovery-"));
  await mkdir(join(root, "live", "blobs"), { recursive: true });
  const objectPath = join(root, "live", "blobs", "shared");
  await writeFile(objectPath, "immutable bytes");

  const database = join(root, "live", "authority.sqlite");
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE host(sequence INTEGER);
    INSERT INTO host VALUES (4);
    CREATE TABLE runs(run_id TEXT, state TEXT);
    INSERT INTO runs VALUES ('active', 'executing');
  `);
  db.close();

  const manager = new OnlineRecoverySnapshots({ root, database });
  return { root, manager, objectPath };
}

test("changed-day scheduling skips unchanged authority and catches up after healthy startup", async () => {
  const { root, manager } = await createRecoveryFixture();
  try {
    assert.equal(
      await manager.runScheduled({ now: 0, change: 4, healthySince: 0 }),
      null,
    );
    const first = await manager.runScheduled({
      now: DAY_IN_MILLISECONDS,
      change: 5,
      healthySince: DAY_IN_MILLISECONDS,
    });
    assert.equal(first?.kind, "scheduled");
    assert.equal(
      await manager.runScheduled({
        now: 2 * DAY_IN_MILLISECONDS,
        change: 5,
        healthySince: 0,
      }),
      null,
    );
    assert.ok(
      await manager.runScheduled({
        now: 3 * DAY_IN_MILLISECONDS,
        change: 6,
        healthySince: 3 * DAY_IN_MILLISECONDS,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshots copy a coherent barrier, independent deduplicated objects, and interruption semantics", async () => {
  const { root, manager, objectPath } = await createRecoveryFixture();
  try {
    const request = {
      now: 10,
      barrier: "host:epoch:4",
      change: 4,
      objects: [{ path: "blobs/shared", livePath: objectPath }],
      checkpoints: [{ sessionId: "s1", checkpoint: "verified-3" }],
    };
    const manualSnapshot = await manager.create({
      ...request,
      kind: "manual",
      reason: "Before experiment",
    });
    const riskBoundarySnapshot = await manager.create({
      ...request,
      now: 11,
      kind: "risk-boundary",
      reason: "upgrade:0.2",
    });

    const [manualObject] = manualSnapshot.objects;
    const [riskBoundaryObject] = riskBoundarySnapshot.objects;
    assert.ok(manualObject);
    assert.ok(riskBoundaryObject);

    assert.equal(manualSnapshot.restore.executingRuns, "interrupted");
    assert.deepEqual(manualSnapshot.checkpoints, request.checkpoints);
    assert.equal(riskBoundaryObject.digest, manualObject.digest);
    assert.equal(
      (await manager.status()).storageBytes,
      Buffer.byteLength("immutable bytes"),
    );

    await writeFile(objectPath, "damaged live copy");
    const recoveryObjectPath = join(
      root,
      "recovery",
      "objects",
      manualObject.digest,
    );
    assert.equal(await readFile(recoveryObjectPath, "utf8"), "immutable bytes");
    assert.equal((await stat(recoveryObjectPath)).nlink, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rotation preserves seven daily points and protected manual/upgrade points; verification reports corruption", async () => {
  const { root, manager, objectPath } = await createRecoveryFixture();
  try {
    const objects = [{ path: "blob", livePath: objectPath }];
    for (let day = 1; day <= 9; day++) {
      await manager.create({
        kind: "scheduled",
        now: day * DAY_IN_MILLISECONDS,
        barrier: `b${day}`,
        change: day,
        objects,
        checkpoints: [],
      });
    }
    const manualSnapshot = await manager.create({
      kind: "manual",
      reason: "mine",
      now: 10 * DAY_IN_MILLISECONDS,
      barrier: "manual",
      change: 10,
      objects,
      checkpoints: [],
    });
    const upgradeSnapshot = await manager.create({
      kind: "risk-boundary",
      reason: "upgrade",
      now: 11 * DAY_IN_MILLISECONDS,
      barrier: "upgrade",
      change: 11,
      objects,
      checkpoints: [],
    });

    const status = await manager.status();
    assert.equal(
      status.snapshots.filter(snapshot => snapshot.kind === "scheduled")
        .length,
      7,
    );
    assert.ok(
      status.snapshots.some(
        snapshot =>
          snapshot.id === manualSnapshot.id &&
          snapshot.protectedReason === "mine",
      ),
    );
    assert.ok(
      status.snapshots.some(
        snapshot =>
          snapshot.id === upgradeSnapshot.id &&
          snapshot.protectedReason === "upgrade",
      ),
    );

    const [manualObject] = manualSnapshot.objects;
    assert.ok(manualObject);
    await writeFile(
      join(root, "recovery", "objects", manualObject.digest),
      "corrupt",
    );
    assert.equal(
      (await manager.verify(manualSnapshot.id)).verification,
      "corrupt",
    );
    await manager.delete(manualSnapshot.id);
    assert.ok(
      !(await manager.status()).snapshots.some(
        snapshot => snapshot.id === manualSnapshot.id,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
