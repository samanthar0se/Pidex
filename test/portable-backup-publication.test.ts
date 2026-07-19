import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PortableBackupPublisher,
  type PortableBackupBundle,
} from "../packages/host/src/portable-backups.js";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const bundle = (operationId: string, content: string): PortableBackupBundle => ({
  bytes: Buffer.from(content),
  metadata: { operationId, barrier: 7, compatibility: "pidex-v1" },
  authenticate: path => readFileSync(path, "utf8") === content,
});

test("authenticated backup publication precedes its rebuildable catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-backups-"));
  try {
    const publisher = new PortableBackupPublisher(root);
    const first = bundle("backup-1", "encrypted-and-authenticated");
    const expectedId = `sha256:${digest(first.bytes)}`;
    assert.equal(publisher.publish(first).bundleId, expectedId);
    assert.equal(publisher.catalog()[0]?.bundleId, expectedId);

    // Equivalent retries are idempotent; an operation collision cannot replace
    // either the immutable bytes or catalog authority.
    assert.equal(publisher.publish(first).outcome, "already-published");
    assert.throws(() => publisher.publish(bundle("backup-1", "other")), /operation collision/);
    assert.equal(publisher.catalog()[0]?.bundleId, expectedId);

    // Cancellation at the publication/catalog boundary may orphan a complete
    // bundle, but can never advertise it.
    const cancelled = new AbortController();
    cancelled.abort();
    assert.throws(
      () => publisher.publish(bundle("backup-2", "complete-two"), cancelled.signal),
      /aborted/,
    );
    assert.equal(publisher.catalog().length, 1);

    // The catalog is only a replaceable projection and recovers from damage.
    writeFileSync(join(root, "operations.json"), "damaged");
    assert.deepEqual(publisher.rebuildCatalog(), publisher.catalog());
    assert.equal(publisher.catalog().length, 1);

    const destination = join(root, "user-owned.copy");
    writeFileSync(destination, first.bytes);
    assert.equal(publisher.verifyDestination(expectedId, destination, first.authenticate), true);
    writeFileSync(destination, "tampered");
    assert.equal(publisher.verifyDestination(expectedId, destination, first.authenticate), false);
    assert.equal(existsSync(destination), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
