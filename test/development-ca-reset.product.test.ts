import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEVELOPMENT_CA_FILES,
  developmentCaDirectory,
  resetDevelopmentCa,
  setupDevelopmentCa,
} from "../packages/host/src/development-ca.js";

test("setup reuses the existing CA and reset removes only that CA before rotation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-reset-"));
  const profileRoot = join(root, "profile");
  const removedFingerprints: string[] = [];

  try {
    const initial = setupDevelopmentCa({
      profileRoot,
      trustCurrentUserCertificate: () => {},
    });
    const existing = setupDevelopmentCa({
      profileRoot,
      trustCurrentUserCertificate: () => {},
    });
    assert.equal(initial.status, "created");
    assert.equal(existing.status, "unchanged");
    assert.equal(existing.fingerprint, initial.fingerprint);

    const result = resetDevelopmentCa({
      profileRoot,
      removeCurrentUserCertificate(fingerprint) {
        removedFingerprints.push(fingerprint);
      },
    });
    assert.match(result.warning, /every checkout.*previously trusted LAN client/i);
    assert.match(result.warning, /setup.*one-time client trust/i);
    assert.deepEqual(removedFingerprints, [initial.fingerprint]);
    assert.equal(result.removedFingerprint, initial.fingerprint);
    assert.equal(result.nextAction, "setup");
    await assertDevelopmentCaFilesRemoved(profileRoot);

    const replacement = setupDevelopmentCa({
      profileRoot,
      trustCurrentUserCertificate: () => {},
    });
    assert.equal(replacement.status, "created");
    assert.notEqual(replacement.fingerprint, initial.fingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reset removes profile CA files and requests manual cleanup when trust removal fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-reset-"));
  const profileRoot = join(root, "profile");

  try {
    const certificate = setupDevelopmentCa({
      profileRoot,
      trustCurrentUserCertificate: () => {},
    });
    const result = resetDevelopmentCa({
      profileRoot,
      removeCurrentUserCertificate: fingerprint => {
        assert.equal(fingerprint, certificate.fingerprint);
        throw new Error("certificate store unavailable");
      },
    });

    assert.match(result.manualCleanup ?? "", /Current User Root manually/);
    assert.equal(result.nextAction, "setup");
    await assertDevelopmentCaFilesRemoved(profileRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reset removes profile CA files and requests manual cleanup when the certificate is unreadable", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-reset-"));
  const profileRoot = join(root, "profile");

  try {
    const certificate = setupDevelopmentCa({
      profileRoot,
      trustCurrentUserCertificate: () => {},
    });
    await writeFile(certificate.certificatePath, "not a certificate");

    const result = resetDevelopmentCa({
      profileRoot,
      removeCurrentUserCertificate: () => {
        assert.fail("an unreadable certificate cannot identify a trust entry");
      },
    });
    assert.equal(result.nextAction, "setup");
    assert.match(result.manualCleanup ?? "", /Current User Root manually/);
    await assertDevelopmentCaFilesRemoved(profileRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function assertDevelopmentCaFilesRemoved(
  profileRoot: string,
): Promise<void> {
  const directory = developmentCaDirectory(profileRoot);
  for (const file of DEVELOPMENT_CA_FILES) {
    await assert.rejects(readFile(join(directory, file)));
  }
}
