import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { PiAdapter } from "../packages/adapters/src/index.js";
import {
  DataGenerationManager,
  MigrationError,
  PiArtifactMigrationManager,
} from "../packages/host/src/migration.js";

test("authority migration validates a new generation before atomic activation and preserves its source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-migration-"));
  try {
    const oldDirectory = join(root, "generations", "old-schema-1");
    await mkdir(oldDirectory, { recursive: true });
    const oldPath = join(oldDirectory, "authority.sqlite");
    const old = new DatabaseSync(oldPath);
    old.exec("PRAGMA user_version=1; CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES ('old')");
    old.close();
    const manager = new DataGenerationManager(root);
    manager.activate({ release: "old", schema: 1, directory: "old-schema-1" });

    assert.throws(
      () =>
        manager.migrate({
          release: "bad",
          schema: 2,
          supportedPriorSchemas: [1],
          migrate: db => db.exec("UPDATE facts SET value='changed'"),
          validate: () => {
            throw new Error("invalid release");
          },
        }),
      (error: unknown) =>
        error instanceof MigrationError && error.code === "validation-failed",
    );
    assert.equal(manager.active()?.directory, "old-schema-1");

    const source = new DatabaseSync(oldPath, { readOnly: true });
    assert.equal(source.prepare("SELECT value FROM facts").get()?.value, "old");
    source.close();

    let protectedBoundaryCreated = false;
    const active = manager.migrate({
      release: "new",
      schema: 2,
      supportedPriorSchemas: [1],
      createProtectedRecoverySnapshot: () => {
        protectedBoundaryCreated = true;
      },
      migrate: db =>
        db.exec(
          "ALTER TABLE facts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
        ),
      validate: db =>
        assert.equal(
          db.prepare("SELECT revision FROM facts").get()?.revision,
          1,
        ),
    });
    assert.equal(active?.schema, 2);
    assert.equal(protectedBoundaryCreated, true);

    const preserved = new DatabaseSync(oldPath, { readOnly: true });
    assert.equal(
      preserved.prepare("PRAGMA user_version").get()?.user_version,
      1,
    );
    preserved.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi artifacts migrate lazily by copy and a typed failure leaves source and other history readable", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-pi-migration-"));
  try {
    await mkdir(join(root, "artifacts", "source"), { recursive: true });
    await writeFile(join(root, "artifacts", "source", "one.pi"), "old-one");
    await writeFile(join(root, "timeline.json"), "unaffected history");
    const source = {
      sessionId: "one",
      pidexVersion: "0.1",
      piVersion: "pi-old",
      artifact: "artifacts/source/one.pi",
      checkpoint: "old-cp",
    };
    const manager = new PiArtifactMigrationManager(root);
    const worker: PiAdapter = {
      kind: "deterministic",
      migrateArtifact: async request => {
        await writeFile(request.destinationPath, "new-one");
        return { checkpoint: "new-cp" };
      },
      flushCheckpoint: async (_session, checkpoint) => checkpoint,
    };
    const migrated = await manager.wake(
      source,
      { pidexVersion: "0.2", piVersion: "pi-new" },
      worker,
    );
    assert.equal(await readFile(join(root, source.artifact), "utf8"), "old-one");
    assert.equal(
      await readFile(join(root, migrated.artifact), "utf8"),
      "new-one",
    );

    const failingWorker: PiAdapter = {
      ...worker,
      migrateArtifact: async () => {
        throw new Error("malformed-old-artifact");
      },
    };
    await assert.rejects(
      manager.wake(
        { ...source, sessionId: "broken" },
        { pidexVersion: "0.3", piVersion: "pi-bad" },
        failingWorker,
      ),
      (error: unknown) =>
        error instanceof MigrationError &&
        error.code === "artifact-migration-failed",
    );
    assert.equal(
      await readFile(join(root, "timeline.json"), "utf8"),
      "unaffected history",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
