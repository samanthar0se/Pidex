import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PortableBackups } from "../packages/host/src/portable-backup.js";

test("portable backup drains, encrypts all portable state, and distinguishes verification stages", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-backup-"));
  try {
    const database = join(root, "authority.sqlite");
    const blob = join(root, "blob");
    const passphrase = "correct horse battery staple";
    await writeFile(database, "coherent database");
    await writeFile(blob, "artifact bytes");

    const acceptance: boolean[] = [];
    const backups = new PortableBackups({
      root,
      setMutationAcceptance: value => acceptance.push(value),
      drain: async () => true,
    });
    const record = await backups.create({
      clientId: "phone",
      passphrase,
      barrier: "epoch:7",
      database,
      files: [{ bundlePath: "blobs/a", sourcePath: blob }],
      identity: { hostId: "host-1", certificateAuthority: "portable-ca" },
      versions: { release: "pidex@0.1.0", schema: 1 },
    });

    assert.deepEqual(acceptance, [false, true]);
    assert.equal(record.bundleVerification, "verified");
    assert.equal(record.delivery, "not-delivered");
    assert.doesNotMatch(
      await readFile(record.bundlePath, "utf8"),
      /coherent database|artifact bytes|portable-ca|correct horse/,
    );
    assert.doesNotMatch(
      await readFile(
        join(root, "portable-backups", "operations.json"),
        "utf8",
      ),
      /correct horse/,
    );

    const delivered = await backups.deliver(record.id, 3);
    assert.equal(delivered.delivery, "delivered-stream-verified");
    const destination = join(root, "user-owned.pidex-backup");
    await writeFile(destination, await readFile(record.bundlePath));
    assert.equal(
      (await backups.verifyDestination(record.id, destination))
        .destinationVerification,
      "verified",
    );
    await writeFile(destination, "tampered");
    await assert.rejects(
      backups.verifyDestination(record.id, destination),
      /destination-hash-mismatch/,
    );
    await assert.rejects(
      backups.verifyBundle(record.id, "wrong"),
      /backup-authentication-failed/,
    );
    await writeFile(
      record.bundlePath,
      Buffer.concat([await readFile(record.bundlePath), Buffer.from("x")]),
    );
    await assert.rejects(
      backups.verifyBundle(record.id, passphrase),
      /backup-authentication-failed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a blocked backup can be cancelled by any client and resumes mutation acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-backup-failure-"));
  try {
    const database = join(root, "db");
    await writeFile(database, "db");

    let acceptingMutations = true;
    let resolveDrainStarted!: () => void;
    const drainStarted = new Promise<void>(resolve => {
      resolveDrainStarted = resolve;
    });
    const backups = new PortableBackups({
      root,
      setMutationAcceptance: value => {
        acceptingMutations = value;
      },
      drain: async ({ signal }) => {
        resolveDrainStarted();
        await new Promise(resolve =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        return false;
      },
      drainTimeoutMs: 20,
    });
    const creation = backups.create({
      clientId: "one",
      passphrase: "secret",
      barrier: "b",
      database,
      files: [],
      identity: { hostId: "h", certificateAuthority: "ca" },
      versions: { release: "r", schema: 1 },
    });

    await drainStarted;
    assert.equal(await backups.cancelActive("other-client"), true);
    await assert.rejects(creation, /backup-cancelled/);
    assert.equal(acceptingMutations, true);
    assert.equal((await backups.catalog()).at(-1)?.state, "aborted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a timed-out drain aborts the backup and resumes mutation acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-backup-timeout-"));
  try {
    const database = join(root, "db");
    await writeFile(database, "db");

    const acceptance: boolean[] = [];
    const backups = new PortableBackups({
      root,
      setMutationAcceptance: value => acceptance.push(value),
      drain: async ({ signal }) => {
        await new Promise(resolve =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        return false;
      },
      drainTimeoutMs: 10,
    });

    await assert.rejects(
      backups.create({
        clientId: "phone",
        passphrase: "secret",
        barrier: "b",
        database,
        files: [],
        identity: { hostId: "h", certificateAuthority: "ca" },
        versions: { release: "r", schema: 1 },
      }),
      /backup-drain-timeout/,
    );
    assert.deepEqual(acceptance, [false, true]);
    assert.equal((await backups.catalog()).at(-1)?.state, "aborted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup aborts abandoned backups and removes their staging directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-backup-abandoned-"));
  try {
    const backupDirectory = join(root, "portable-backups");
    await mkdir(join(backupDirectory, "abandoned.stage"), {
      recursive: true,
    });
    await writeFile(
      join(backupDirectory, "operations.json"),
      JSON.stringify([
        {
          id: "abandoned",
          createdAt: 1,
          state: "draining",
          barrier: "b",
          compatibility: { release: "r", schema: 1 },
          delivery: "not-delivered",
        },
      ]),
    );

    const backups = new PortableBackups({
      root,
      setMutationAcceptance: () => {},
      drain: async () => true,
    });

    assert.deepEqual(await backups.catalog(), [
      {
        id: "abandoned",
        createdAt: 1,
        state: "aborted",
        barrier: "b",
        compatibility: { release: "r", schema: 1 },
        delivery: "not-delivered",
        failure: "daemon-lost-passphrase-discarded",
      },
    ]);
    assert.equal(
      (await readdir(backupDirectory)).includes("abandoned.stage"),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
