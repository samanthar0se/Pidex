import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { ensureDevelopmentCertificate, resetDevelopmentCa, setupDevelopmentCa } from "../packages/host/src/development-certificate.js";

test("one profile Development CA survives restarts and signs disposable leaves in separate checkouts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-"));
  const profile = join(root, "profile");
  const trusted: string[] = [];
  const removed: string[] = [];
  const windows = { ...adaptersFor("deterministic").windows,
    trustCurrentUserCertificate: (path: string) => trusted.push(path),
    removeCurrentUserCertificate: (path: string) => removed.push(path) };
  try {
    const setup = setupDevelopmentCa(profile, windows);
    assert.equal(setup.status, "created");
    assert.equal(setupDevelopmentCa(profile, windows).status, "unchanged");
    const first = ensureDevelopmentCertificate(profile, join(root, "checkout-a"), ["localhost"]);
    const second = ensureDevelopmentCertificate(profile, join(root, "checkout-b"), ["devbox", "192.168.1.9"]);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(ensureDevelopmentCertificate(profile, join(root, "checkout-b"), ["devbox", "192.168.1.9"]).replaced, false);
    const changed = ensureDevelopmentCertificate(profile, join(root, "checkout-b"), ["other", "192.168.1.9"]);
    assert.equal(changed.replaced, true);
    assert.equal(changed.fingerprint, setup.fingerprint);
    assert.match(new X509Certificate(changed.cert).subjectAltName!, /DNS:other/);
    assert.match(new X509Certificate(changed.cert).subjectAltName!, /IP Address:192\.168\.1\.9/);

    await unlink(setup.certificatePath);
    assert.throws(() => ensureDevelopmentCertificate(profile, join(root, "checkout-c"), ["localhost"]), /Development CA unusable.*reset.*setup/);
    assert.throws(() => setupDevelopmentCa(profile, windows), /Development CA unusable/);
    await writeFile(setup.certificatePath, first.ca);
    const reset = resetDevelopmentCa(profile, windows);
    assert.equal(reset.cleanup, "complete");
    assert.deepEqual(removed, [setup.certificatePath]);
    const replacement = setupDevelopmentCa(profile, windows);
    assert.notEqual(replacement.fingerprint, setup.fingerprint);
    assert.equal(trusted.length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Development CA startup refuses corrupt profile material without replacing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-"));
  const profile = join(root, "profile");
  try {
    const setup = setupDevelopmentCa(profile, adaptersFor("deterministic").windows);
    await writeFile(setup.certificatePath, "corrupt");
    assert.throws(() => ensureDevelopmentCertificate(profile, join(root, "checkout"), ["localhost"]), /Startup did not replace/);
    assert.equal((await readFile(setup.certificatePath, "utf8")), "corrupt");
  } finally { await rm(root, { recursive: true, force: true }); }
});
