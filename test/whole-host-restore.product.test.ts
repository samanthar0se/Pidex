import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DataGenerationManager } from "../packages/host/src/migration.js";
import { WholeHostRestore, type RestoreCandidate } from "../packages/host/src/whole-host-restore.js";

test("whole-Host restore skips corrupt newest sources and atomically activates reset semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-restore-"));
  try {
    await mkdir(join(root, "generations", "current"), { recursive: true });
    const current = join(root, "generations", "current", "authority.sqlite");
    const old = new DatabaseSync(current);
    old.exec(
      "CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES ('current')",
    );
    old.close();
    new DataGenerationManager(root).activate({
      release: "r2",
      schema: 2,
      directory: "current",
    });

    const source = join(root, "snapshot.sqlite");
    const db = new DatabaseSync(source);
    db.exec(
      "PRAGMA user_version=1; CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES ('restored'); CREATE TABLE recovery(epoch TEXT, runs TEXT, interactions TEXT, queued TEXT)",
    );
    db.close();

    const hash = createHash("sha256")
      .update(await readFile(source))
      .digest("hex");
    const candidate: RestoreCandidate = {
      id: "good",
      createdAt: 10,
      kind: "snapshot",
      database: source,
      databaseDigest: hash,
      files: [],
      identity: { hostId: "host", origin: "https://pidex.local" },
      schema: 1,
      release: "r1",
      barrier: "revision:4",
      runs: { executing: 2, cancelling: 1, queued: 3 },
      devices: { paired: 2, revoked: 1 },
      encrypted: false,
      encryptionVerified: true,
    };
    const restore = new WholeHostRestore({
      root,
      hostId: "host",
      origin: "https://pidex.local",
      schema: 2,
      release: "r2",
      revision: () => 7,
      authorityValid: () => true,
      isPaired: id => id === "phone",
      daemonStopped: () => true,
      migrate: database =>
        database.exec(
          "ALTER TABLE facts ADD COLUMN migrated INTEGER DEFAULT 1",
        ),
      reconcile: (database, epoch) =>
        database
          .prepare(
            "INSERT INTO recovery VALUES (?, 'interrupted', 'withdrawn', 'held')",
          )
          .run(epoch),
    });

    assert.throws(
      () =>
        restore.preview({
          candidates: [candidate],
          deviceId: "stranger",
          expectedRevision: 7,
        }),
      /paired-device-required/,
    );
    const preview = restore.preview({
      candidates: [
        { ...candidate, id: "bad", createdAt: 11, databaseDigest: "bad" },
        candidate,
      ],
      deviceId: "phone",
      expectedRevision: 7,
    });

    assert.equal(preview.candidate.id, "good");
    assert.deepEqual(preview.skipped, [
      { id: "bad", reason: "database-digest-failed" },
    ]);
    assert.equal(preview.migration.required, true);
    assert.match(
      preview.warnings.join(" "),
      /revoked after this point may become Paired/,
    );
    assert.throws(
      () => restore.restore({ candidateId: "good", confirmation: "yes" }),
      /confirmation-required/,
    );
    const result = restore.restore({
      candidateId: "good",
      confirmation: preview.confirmation,
    });

    assert.notEqual(result.directory, "current");
    assert.equal(
      new DataGenerationManager(root).active()?.directory,
      result.directory,
    );
    const restored = new DatabaseSync(
      join(root, "generations", result.directory, "authority.sqlite"),
      { readOnly: true },
    );
    try {
      assert.deepEqual(
        { ...restored.prepare("SELECT value, migrated FROM facts").get() },
        { value: "restored", migrated: 1 },
      );
      assert.deepEqual(
        {
          ...restored
            .prepare("SELECT runs, interactions, queued FROM recovery")
            .get(),
        },
        { runs: "interrupted", interactions: "withdrawn", queued: "held" },
      );
    } finally {
      restored.close();
    }
    assert.equal((await readFile(current)).length > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
