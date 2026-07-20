import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  adaptersFor,
  type WindowsPlatformAdapter,
} from "../packages/adapters/src/index.js";
import {
  DEVELOPMENT_CA_FILES,
  resetDevelopmentCa,
  setupDevelopmentCa,
} from "../packages/host/src/development-ca.js";

test("setup reuses the existing CA and reset removes only that CA before rotation", async () => {
  const profileDirectory = await mkdtemp(
    join(tmpdir(), "pidex-development-ca-"),
  );
  const removedFingerprints: string[] = [];
  const windows: WindowsPlatformAdapter = {
    ...adaptersFor("deterministic").windows,
    removeCurrentUserCertificate(fingerprint) {
      removedFingerprints.push(fingerprint);
    },
  };

  try {
    const initial = setupDevelopmentCa(profileDirectory, windows);
    const existing = setupDevelopmentCa(profileDirectory, windows);
    assert.equal(initial.status, "created");
    assert.equal(existing.status, "unchanged");
    assert.equal(existing.fingerprint, initial.fingerprint);

    const result = resetDevelopmentCa(profileDirectory, windows);
    assert.match(result.warning, /every checkout.*previously trusted LAN client/i);
    assert.match(result.warning, /setup.*one-time client trust/i);
    assert.deepEqual(removedFingerprints, [initial.fingerprint]);
    assert.equal(result.removedFingerprint, initial.fingerprint);
    assert.equal(result.nextAction, "setup");
    await assertDevelopmentCaFilesRemoved(profileDirectory);

    const replacement = setupDevelopmentCa(profileDirectory, windows);
    assert.equal(replacement.status, "created");
    assert.notEqual(replacement.fingerprint, initial.fingerprint);
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

test("reset removes local CA files and requests manual cleanup when trust removal fails", async () => {
  const profileDirectory = await mkdtemp(
    join(tmpdir(), "pidex-development-ca-"),
  );
  const windows = adaptersFor("deterministic").windows;

  try {
    const certificate = setupDevelopmentCa(profileDirectory, windows);
    const result = resetDevelopmentCa(profileDirectory, {
      ...windows,
      removeCurrentUserCertificate: fingerprint => {
        assert.equal(fingerprint, certificate.fingerprint);
        throw new Error("certificate store unavailable");
      },
    });

    assert.match(result.manualCleanup ?? "", /Current User Root manually/);
    assert.equal(result.nextAction, "setup");
    await assertDevelopmentCaFilesRemoved(profileDirectory);
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

test("reset removes local CA files and requests manual cleanup when the certificate is unreadable", async () => {
  const profileDirectory = await mkdtemp(
    join(tmpdir(), "pidex-development-ca-"),
  );

  try {
    await writeFile(
      join(profileDirectory, DEVELOPMENT_CA_FILES[0]),
      "not a certificate",
    );
    await writeFile(
      join(profileDirectory, DEVELOPMENT_CA_FILES[1]),
      "private state",
    );

    const result = resetDevelopmentCa(
      profileDirectory,
      adaptersFor("deterministic").windows,
    );
    assert.equal(result.nextAction, "setup");
    assert.match(result.manualCleanup ?? "", /Current User Root manually/);
    await assertDevelopmentCaFilesRemoved(profileDirectory);
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

async function assertDevelopmentCaFilesRemoved(
  profileDirectory: string,
): Promise<void> {
  for (const file of DEVELOPMENT_CA_FILES) {
    await assert.rejects(readFile(join(profileDirectory, file)));
  }
}
