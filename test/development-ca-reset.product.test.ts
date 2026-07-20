import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptersFor } from "../packages/adapters/src/index.js";
import {
  DEVELOPMENT_CA_FILES,
  resetDevelopmentCa,
  setupDevelopmentCa,
} from "../packages/host/src/development-ca.js";

test("explicit reset removes only the identifiable CA and setup rotates it", async () => {
  const profile = await mkdtemp(join(tmpdir(), "pidex-development-ca-"));
  const removed: string[] = [];
  const windows = {
    ...adaptersFor("deterministic").windows,
    removeCurrentUserCertificate: (fingerprint: string) => removed.push(fingerprint),
  };
  try {
    const initial = setupDevelopmentCa(profile, windows);
    const result = resetDevelopmentCa(profile, windows);
    assert.match(result.warning, /every checkout.*previously trusted LAN client/i);
    assert.match(result.warning, /setup.*one-time client trust/i);
    assert.deepEqual(removed, [initial.fingerprint]);
    assert.equal(result.nextAction, "setup");
    for (const file of DEVELOPMENT_CA_FILES) {
      await assert.rejects(readFile(join(profile, file)));
    }

    const replacement = setupDevelopmentCa(profile, windows);
    assert.equal(replacement.status, "created");
    assert.notEqual(replacement.fingerprint, initial.fingerprint);

    const failedRemoval = resetDevelopmentCa(profile, {
      ...windows,
      removeCurrentUserCertificate: fingerprint => {
        assert.equal(fingerprint, replacement.fingerprint);
        throw new Error("certificate store unavailable");
      },
    });
    assert.match(failedRemoval.manualCleanup ?? "", /Current User Root manually/);
    assert.equal(failedRemoval.nextAction, "setup");
    for (const file of DEVELOPMENT_CA_FILES) {
      await assert.rejects(readFile(join(profile, file)));
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("unreadable public state and trust failure are best effort", async () => {
  const profile = await mkdtemp(join(tmpdir(), "pidex-development-ca-"));
  try {
    await writeFile(join(profile, DEVELOPMENT_CA_FILES[0]), "not a certificate");
    await writeFile(join(profile, DEVELOPMENT_CA_FILES[1]), "private state");
    const result = resetDevelopmentCa(profile, adaptersFor("deterministic").windows);
    assert.equal(result.nextAction, "setup");
    assert.match(result.manualCleanup ?? "", /Current User Root manually/);
    for (const file of DEVELOPMENT_CA_FILES) {
      await assert.rejects(readFile(join(profile, file)));
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
