import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  publishImmutableSourceClosure,
  verifyPublishedSourceClosure,
  type SourceClosureFile,
} from "../packages/source/src/source-closure.js";

const requiredFiles = ([
  ["runtime", "runtime/node.exe"],
  ["emitted-code", "app/daemon.js"],
  ["dependencies", "app/node_modules/zod/index.js"],
  ["pi", "app/node_modules/@earendil-works/pi-coding-agent/index.js"],
  ["companion", "app/companion.js"],
  ["addon", "native/pidex_windows.node"],
  ["launcher", "native/pidex-launcher.exe"],
  ["schemas", "schemas/launch.json"],
  ["tools", "tools/certificate.exe"],
  ["lockfile", "package-lock.json"],
] as const).map(([role, path]) => ({ role, path, bytes: Buffer.from(path) })) satisfies SourceClosureFile[];

const plan = () => ({
  schemaVersion: 1 as const,
  trustClass: "local-source" as const,
  inputMode: "source-build" as const,
  node: { version: "24.1.0", architecture: "x64" as const },
  nodeApi: 10,
  pi: { version: "0.80.10" as const, integrity: "sha512-pinned" },
  toolchain: {
    msvc: "19.44",
    windowsSdk: "10.0.26100.0",
    cmake: "4.0.0",
    cpp: "20" as const,
  },
  sourceIdentity: "git:abc123:dirty",
  files: requiredFiles,
});

test("publishes one complete content-addressed local-source closure", () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-closure-"));
  const published = publishImmutableSourceClosure({
    releasesDirectory: join(root, "releases"),
    plan: plan(),
  });

  assert.match(published.releaseId, /^sha256-[a-f0-9]{64}$/);
  const evidence = verifyPublishedSourceClosure(published.directory);
  assert.equal(evidence.releaseId, published.releaseId);
  assert.deepEqual(
    evidence.roles,
    [...new Set(requiredFiles.map(file => file.role))].sort(),
  );

  const manifest = JSON.parse(
    readFileSync(join(published.directory, "closure.json"), "utf8"),
  );
  assert.equal(manifest.trustClass, "local-source");
  assert.equal(manifest.pi.version, "0.80.10");
  assert.equal(manifest.files.length, requiredFiles.length);
  assert.equal(
    JSON.parse(readFileSync(join(published.directory, "sbom.cdx.json"), "utf8"))
      .components.length,
    requiredFiles.length,
  );

  writeFileSync(join(root, "mutable-output.js"), "changed after publish");
  assert.equal(verifyPublishedSourceClosure(published.directory).releaseId, published.releaseId);
});

test("fails closed when a required runtime role is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-closure-"));
  assert.throws(
    () =>
      publishImmutableSourceClosure({
        releasesDirectory: join(root, "releases"),
        plan: { ...plan(), files: requiredFiles.filter(file => file.role !== "launcher") },
      }),
    /missing required closure role: launcher/i,
  );
});

test("published bytes cannot be rewritten", () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-closure-"));
  const published = publishImmutableSourceClosure({
    releasesDirectory: join(root, "releases"),
    plan: plan(),
  });

  assert.throws(
    () => writeFileSync(join(published.directory, "runtime", "node.exe"), "tampered"),
    /EACCES|EPERM|permission denied/i,
  );
  assert.equal(verifyPublishedSourceClosure(published.directory).releaseId, published.releaseId);
});
