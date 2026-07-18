import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  activateSignedRelease,
  ReleaseUpdateError,
  SignedReleaseStore,
  type ActivationHooks,
  type ReleaseManifest,
  type StagedRelease,
} from "../packages/launcher/src/release-update.js";

test("only a complete signed matching release becomes ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-release-"));
  const source = join(root, "download");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  try {
    await mkdir(source);
    await writeFile(join(source, "daemon.exe"), "same-build");
    const manifest: ReleaseManifest = {
      releaseId: "2.0.0",
      protocolGeneration: "2",
      daemonGeneration: "2",
      workerGeneration: "2",
      dataSchema: 2,
      files: [
        {
          path: "daemon.exe",
          size: 10,
          sha256: createHash("sha256")
            .update("same-build")
            .digest("hex"),
        },
      ],
    };
    const metadata = Buffer.from(JSON.stringify(manifest));
    const signingRoot = publicKey.export({ type: "spki", format: "pem" });
    const store = new SignedReleaseStore(root, signingRoot);

    assert.throws(
      () => store.stage(source, metadata, Buffer.alloc(64)),
      (error: unknown) =>
        error instanceof ReleaseUpdateError &&
        error.code === "signature-invalid",
    );

    const mixedGenerationMetadata = Buffer.from(
      JSON.stringify({ ...manifest, workerGeneration: "1" }),
    );
    assert.throws(
      () =>
        store.stage(
          source,
          mixedGenerationMetadata,
          sign(null, mixedGenerationMetadata, privateKey),
        ),
      (error: unknown) =>
        error instanceof ReleaseUpdateError &&
        error.code === "mixed-generation",
    );

    await rm(join(source, "daemon.exe"));
    assert.throws(
      () =>
        store.stage(source, metadata, sign(null, metadata, privateKey)),
      (error: unknown) =>
        error instanceof ReleaseUpdateError &&
        error.code === "package-incomplete",
    );

    await writeFile(join(source, "daemon.exe"), "same-build");
    const ready = store.stage(
      source,
      metadata,
      sign(null, metadata, privateKey),
    );
    assert.equal(ready.state, "ready");
    assert.equal(
      await readFile(join(ready.directory, "daemon.exe"), "utf8"),
      "same-build",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "activation forces normal Stop and rolls back a pre-acceptance readiness failure",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pidex-activate-"));
    const events: string[] = [];
    let time = 0;
    await writeFile(join(root, "active-release"), "1.0.0");

    const release: StagedRelease = {
      state: "ready",
      directory: "unused",
      manifest: {
        releaseId: "2.0.0",
        protocolGeneration: "2",
        daemonGeneration: "2",
        workerGeneration: "2",
        dataSchema: 2,
        files: [{ path: "x", size: 1, sha256: "0".repeat(64) }],
      },
    };
    const hooks: ActivationHooks = {
      stopAcceptingMutations: () => {
        events.push("drain");
      },
      resumeAcceptingMutations: () => {
        events.push("resume");
      },
      isQuiescent: () => true,
      stopAffectedSessions: () => {
        events.push("stop");
      },
      flushAndStopWorkers: () => {
        events.push("flush-workers");
      },
      activateData: async () => {
        events.push("data-2");
        return () => {
          events.push("data-1");
        };
      },
      startMatchingRelease: async () => {
        events.push("start");
        throw new Error("readiness timeout");
      },
      hasAcceptedNewMutations: () => false,
      now: () => time,
      sleep: async milliseconds => {
        time += milliseconds;
      },
    };

    try {
      await assert.rejects(
        activateSignedRelease({ root, release, hooks, force: true }),
      );
      assert.equal(
        (await readFile(join(root, "active-release"), "utf8")).trim(),
        "1.0.0",
      );
      assert.deepEqual(events, [
        "drain",
        "stop",
        "flush-workers",
        "data-2",
        "start",
        "data-1",
        "resume",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
