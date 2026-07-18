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
  type ReleaseManifest,
} from "../packages/launcher/src/release-update.js";

test("only a complete signed matching release becomes ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-release-"));
  const source = join(root, "download");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  try {
    await mkdir(source);
    await writeFile(join(source, "daemon.exe"), "same-build");
    const manifest: ReleaseManifest = {
      releaseId: "2.0.0", protocolGeneration: "2", daemonGeneration: "2",
      workerGeneration: "2", dataSchema: 2,
      files: [{ path: "daemon.exe", size: 10, sha256: createHash("sha256").update("same-build").digest("hex") }],
    };
    const metadata = Buffer.from(JSON.stringify(manifest));
    const store = new SignedReleaseStore(root, publicKey.export({ type: "spki", format: "pem" }));
    assert.throws(() => store.stage(source, metadata, Buffer.alloc(64)),
      (error: unknown) => error instanceof ReleaseUpdateError && error.code === "signature-invalid");
    await rm(join(source, "daemon.exe"));
    assert.throws(() => store.stage(source, metadata, sign(null, metadata, privateKey)),
      (error: unknown) => error instanceof ReleaseUpdateError && error.code === "package-incomplete");
    await writeFile(join(source, "daemon.exe"), "same-build");
    const ready = store.stage(source, metadata, sign(null, metadata, privateKey));
    assert.equal(ready.state, "ready");
    assert.equal(await readFile(join(ready.directory, "daemon.exe"), "utf8"), "same-build");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("activation forces normal Stop, commits after readiness, and rolls back pre-acceptance failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-activate-"));
  const events: string[] = [];
  let time = 0;
  await writeFile(join(root, "active-release"), "1.0.0");
  const release = { state: "ready" as const, directory: "unused", manifest: {
    releaseId: "2.0.0", protocolGeneration: "2", daemonGeneration: "2", workerGeneration: "2", dataSchema: 2,
    files: [{ path: "x", size: 1, sha256: "0".repeat(64) }],
  }};
  const hooks = {
    stopAcceptingMutations: () => { events.push("drain"); },
    resumeAcceptingMutations: () => { events.push("resume"); },
    isQuiescent: () => true,
    stopAffectedSessions: () => { events.push("stop"); },
    flushAndStopWorkers: () => { events.push("flush-workers"); },
    activateData: async () => { events.push("data-2"); return () => { events.push("data-1"); }; },
    startMatchingRelease: async () => { events.push("start"); throw new Error("readiness timeout"); },
    hasAcceptedNewMutations: () => false,
    now: () => time,
    sleep: async (ms: number) => { time += ms; },
  };
  try {
    await assert.rejects(activateSignedRelease({ root, release, hooks, force: true }));
    assert.equal((await readFile(join(root, "active-release"), "utf8")).trim(), "1.0.0");
    assert.deepEqual(events, ["drain", "stop", "flush-workers", "data-2", "start", "data-1", "resume"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
