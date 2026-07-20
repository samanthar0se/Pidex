import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  activateRunnableRelease,
  publishRunnableRelease,
  type ReleaseActivationOperations,
} from "../packages/launcher/src/release.js";

test("publishes only a completely signed runnable release", () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-release-"));
  const candidate = join(root, "download");
  mkdirSync(candidate);
  writeFileSync(join(candidate, "host.js"), "ready");
  writeFileSync(join(candidate, "sbom.json"), "{}");
  const digest = (name: string): string =>
    createHash("sha256")
      .update(readFileSync(join(candidate, name)))
      .digest("hex");
  const manifest = JSON.stringify({
    schemaVersion: 1,
    releaseId: "pidex@2.0.0",
    protocolGeneration: "2",
    sbom: "sbom.json",
    entrypoint: "host.js",
    files: [
      { path: "host.js", sha256: digest("host.js") },
      { path: "sbom.json", sha256: digest("sbom.json") },
    ],
  });
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  writeFileSync(join(candidate, "manifest.json"), manifest);
  writeFileSync(
    join(candidate, "manifest.sig"),
    sign(null, Buffer.from(manifest), keys.privateKey).toString("base64"),
  );

  const releaseOptions = {
    candidateDir: candidate,
    releasesDir: join(root, "releases"),
    publicKey,
  };
  const published = publishRunnableRelease(releaseOptions);
  assert.equal(readFileSync(join(published, "host.js"), "utf8"), "ready");

  writeFileSync(join(candidate, "host.js"), "mixed");
  assert.throws(() => publishRunnableRelease(releaseOptions), /digest/);
});

test("selects a release only after matching Authority and readiness", async () => {
  const events: string[] = [];
  const operation = (name: string) => async (): Promise<void> => {
    events.push(name);
  };
  const operations: ReleaseActivationOperations = {
    stopMutationAcceptance: operation("stop-mutations"),
    reachQuiescence: operation("quiescent"),
    activateAuthority: async () => {
      events.push("authority");
      return { generation: "data-2" };
    },
    startRelease: async () => {
      events.push("ready");
      return {
        releaseId: "pidex@2",
        authorityGeneration: "data-2",
      };
    },
    replaceReleaseSelector: operation("selector"),
    rollbackAuthority: operation("rollback"),
    resumePriorRelease: operation("prior"),
    restoreMutationAcceptance: operation("restore-mutations"),
  };
  await activateRunnableRelease(
    { releaseId: "pidex@2", protocolGeneration: "2" },
    operations,
  );
  assert.deepEqual(events, [
    "stop-mutations",
    "quiescent",
    "authority",
    "ready",
    "selector",
  ]);
});

test("a readiness mismatch restores prior safe operation without selecting", async () => {
  const events: string[] = [];
  const operation = (name: string) => async (): Promise<void> => {
    events.push(name);
  };
  const operations: ReleaseActivationOperations = {
    stopMutationAcceptance: operation("stop"),
    reachQuiescence: operation("quiet"),
    activateAuthority: async () => ({ generation: "data-2" }),
    startRelease: async () => ({
      releaseId: "wrong",
      authorityGeneration: "data-2",
    }),
    replaceReleaseSelector: operation("selector"),
    rollbackAuthority: operation("rollback"),
    resumePriorRelease: operation("prior"),
    restoreMutationAcceptance: operation("restore"),
  };
  await assert.rejects(
    activateRunnableRelease(
      { releaseId: "pidex@2", protocolGeneration: "2" },
      operations,
    ),
    /does not match/,
  );
  assert.deepEqual(events, ["stop", "quiet", "rollback", "prior", "restore"]);
});
