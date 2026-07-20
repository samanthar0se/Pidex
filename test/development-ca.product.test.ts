import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DevelopmentCaPrerequisiteError,
  setupDevelopmentCa,
} from "../packages/host/src/development-ca.js";

test("setup creates and then reuses one constrained profile Development CA", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-"));
  const profile = join(root, "profile");
  const keyPath = join(
    profile,
    "Pidex",
    "Development CA",
    "pidex-development-ca-key.pem",
  );
  const trusted: string[] = [];
  const options = {
    profileRoot: profile,
    trustCurrentUserCertificate: (path: string) => trusted.push(path),
  };
  try {
    const first = setupDevelopmentCa(options);
    const firstKey = await readFile(keyPath);
    const second = setupDevelopmentCa(options);
    const certificate = new X509Certificate(
      await readFile(first.certificatePath),
    );

    assert.equal(first.status, "created");
    assert.equal(second.status, "unchanged");
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(first.fingerprint, certificate.fingerprint256);
    assert.equal(certificate.ca, true);
    assert.equal(trusted.length, 2);
    assert.ok(trusted.every(path => path === first.certificatePath));
    assert.ok(
      !firstKey.includes(Buffer.from("CERTIFICATE")),
      "only the public path is trusted",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing damaged state is never repaired or rotated", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-"));
  const options = {
    profileRoot: join(root, "profile"),
    trustCurrentUserCertificate: () => {},
  };
  try {
    const first = setupDevelopmentCa(options);
    await unlink(first.certificatePath);
    assert.throws(
      () => setupDevelopmentCa(options),
      /Development CA unusable.*dev:ca:reset.*dev:ca:setup/,
    );
    assert.throws(
      () => setupDevelopmentCa(options),
      /Development CA unusable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt and profile-invalid state fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-"));
  const options = {
    profileRoot: join(root, "profile"),
    trustCurrentUserCertificate: () => {},
  };
  try {
    const first = setupDevelopmentCa(options);
    await writeFile(first.certificatePath, "corrupt");
    assert.throws(() => setupDevelopmentCa(options), /Development CA unusable/);
    assert.throws(
      () => setupDevelopmentCa({ ...options, profileRoot: "relative" }),
      /LocalAppData profile.*invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing OpenSSL has distinct actionable prerequisite guidance", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-ca-"));
  try {
    assert.throws(
      () =>
        setupDevelopmentCa({
          profileRoot: join(root, "profile"),
          trustCurrentUserCertificate: () => {},
          runOpenSsl: () => {
            throw Object.assign(new Error("spawn openssl"), { code: "ENOENT" });
          },
        }),
      (error: unknown) =>
        error instanceof DevelopmentCaPrerequisiteError &&
        /openssl version/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
