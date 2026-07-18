import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PortableBackups } from "../packages/host/src/portable-backup.js";

test("portable backup drains, encrypts all portable state, and distinguishes verification stages", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-backup-"));
  const database = join(root, "authority.sqlite");
  const blob = join(root, "blob");
  await writeFile(database, "coherent database");
  await writeFile(blob, "artifact bytes");
  const acceptance: boolean[] = [];
  const backups = new PortableBackups({
    root,
    setMutationAcceptance: value => acceptance.push(value),
    drain: async () => true,
  });
  try {
    const record = await backups.create({
      clientId: "phone",
      passphrase: "correct horse battery staple",
      barrier: "epoch:7",
      database,
      files: [{ bundlePath: "blobs/a", sourcePath: blob }],
      identity: { hostId: "host-1", certificateAuthority: "portable-ca" },
      versions: { release: "pidex@0.1.0", schema: 1 },
    });

    assert.deepEqual(acceptance, [false, true]);
    assert.equal(record.bundleVerification, "verified");
    assert.equal(record.delivery, "not-delivered");
    assert.doesNotMatch(await readFile(record.bundlePath, "utf8"), /coherent database|artifact bytes|portable-ca|correct horse/);
    assert.doesNotMatch(await readFile(join(root, "portable-backups", "operations.json"), "utf8"), /correct horse/);

    const delivered = await backups.deliver(record.id, 3);
    assert.equal(delivered.delivery, "delivered-stream-verified");
    const destination = join(root, "user-owned.pidex-backup");
    await writeFile(destination, await readFile(record.bundlePath));
    assert.equal((await backups.verifyDestination(record.id, destination)).destinationVerification, "verified");
    await writeFile(destination, "tampered");
    await assert.rejects(backups.verifyDestination(record.id, destination), /destination-hash-mismatch/);
    await assert.rejects(backups.verifyBundle(record.id, "wrong"), /backup-authentication-failed/);
    await writeFile(record.bundlePath, Buffer.concat([await readFile(record.bundlePath), Buffer.from("x")]));
    await assert.rejects(backups.verifyBundle(record.id, "correct horse battery staple"), /backup-authentication-failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("blocked, cancelled, timed-out, and abandoned operations resume acceptance without a force path", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-backup-failure-"));
  const database = join(root, "db");
  await writeFile(database, "db");
  let accept = true;
  const backups = new PortableBackups({
    root,
    setMutationAcceptance: value => { accept = value; },
    drain: async ({ signal }) => {
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      return false;
    },
    drainTimeoutMs: 20,
  });
  const creating = backups.create({
    clientId: "one", passphrase: "secret", barrier: "b", database,
    files: [], identity: { hostId: "h", certificateAuthority: "ca" },
    versions: { release: "r", schema: 1 },
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await backups.cancelActive("other-client"), true);
  await assert.rejects(creating, /backup-cancelled/);
  assert.equal(accept, true);
  assert.equal((await backups.catalog()).at(-1)?.state, "aborted");
  await rm(root, { recursive: true, force: true });
});
