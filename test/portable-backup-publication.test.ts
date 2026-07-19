import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  PortableBackupPublisher,
  type PortableBackupBundle,
} from "../packages/host/src/portable-backups.js";

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createBundle(
  operationId: string,
  content: string,
): PortableBackupBundle {
  return {
    bytes: Buffer.from(content),
    metadata: { operationId, barrier: 7, compatibility: "pidex-v1" },
    authenticate: path => readFileSync(path, "utf8") === content,
  };
}

function withFixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "pidex-backups-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function publishInitialBundle(root: string): {
  publisher: PortableBackupPublisher;
  initialBundle: PortableBackupBundle;
  bundleId: string;
} {
  const publisher = new PortableBackupPublisher(root);
  const initialBundle = createBundle(
    "backup-1",
    "encrypted-and-authenticated",
  );
  const bundleId = `sha256:${digest(initialBundle.bytes)}`;
  publisher.publish(initialBundle);
  return { publisher, initialBundle, bundleId };
}

test("authenticated backup publication precedes its rebuildable catalog", () =>
  withFixture(root => {
    const publisher = new PortableBackupPublisher(root);
    const first = createBundle("backup-1", "encrypted-and-authenticated");
    const expectedId = `sha256:${digest(first.bytes)}`;

    assert.equal(publisher.publish(first).bundleId, expectedId);
    assert.equal(publisher.catalog()[0]?.bundleId, expectedId);
  }));

test(
  "equivalent retries are idempotent and operation collisions preserve authority",
  () =>
    withFixture(root => {
      const { publisher, initialBundle, bundleId } = publishInitialBundle(root);

      assert.equal(
        publisher.publish(initialBundle).outcome,
        "already-published",
      );
      assert.throws(
        () => publisher.publish(createBundle("backup-1", "other")),
        /operation collision/,
      );
      assert.equal(publisher.catalog()[0]?.bundleId, bundleId);
    }),
);

test("pre-publication cancellation leaves the backup catalog unchanged", () =>
  withFixture(root => {
    const { publisher } = publishInitialBundle(root);
    const cancelled = new AbortController();
    cancelled.abort();

    assert.throws(
      () =>
        publisher.publish(
          createBundle("backup-2", "complete-two"),
          cancelled.signal,
        ),
      /aborted/,
    );
    assert.equal(publisher.catalog().length, 1);
  }));

test("cancellation after bundle publication never advertises the orphaned bundle", () =>
  withFixture(root => {
    const { publisher } = publishInitialBundle(root);
    const cancelled = new AbortController();
    const orphan = createBundle("backup-2", "complete-two");
    const authenticate = orphan.authenticate;
    orphan.authenticate = path => {
      const valid = authenticate(path);
      cancelled.abort();
      return valid;
    };

    assert.throws(
      () => publisher.publish(orphan, cancelled.signal),
      /aborted/,
    );
    assert.equal(publisher.catalog().length, 1);
    assert.equal(
      existsSync(join(root, "bundles", `${digest(orphan.bytes)}.pdxbackup`)),
      true,
    );
  }));

test("the rebuildable catalog recovers from its immutable receipts", () =>
  withFixture(root => {
    const { publisher } = publishInitialBundle(root);
    writeFileSync(join(root, "operations.json"), "damaged");

    assert.deepEqual(publisher.rebuildCatalog(), publisher.catalog());
    assert.equal(publisher.catalog().length, 1);
  }));

test(
  "destination verification authenticates exact bytes without taking ownership",
  () =>
    withFixture(root => {
      const { publisher, initialBundle, bundleId } =
        publishInitialBundle(root);
      const destination = join(root, "user-owned.copy");
      writeFileSync(destination, initialBundle.bytes);

      assert.equal(
        publisher.verifyDestination(
          bundleId,
          destination,
          initialBundle.authenticate,
        ),
        true,
      );
      writeFileSync(destination, "tampered");
      assert.equal(
        publisher.verifyDestination(
          bundleId,
          destination,
          initialBundle.authenticate,
        ),
        false,
      );
      assert.equal(existsSync(destination), true);
    }),
);
