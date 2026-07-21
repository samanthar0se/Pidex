import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { activateSourceUpdate } from "../packages/launcher/src/source-update.js";
import { publishImmutableSourceClosure, type SourceClosureFile } from "../packages/source/src/source-closure.js";

const files = ([
  ["runtime", "runtime/node.exe"], ["emitted-code", "app/daemon.js"],
  ["dependencies", "app/node_modules/zod/index.js"], ["pi", "app/node_modules/@earendil-works/pi-coding-agent/index.js"],
  ["companion", "app/companion.js"], ["addon", "native/pidex_windows.node"],
  ["launcher", "native/pidex-launcher.exe"], ["schemas", "schemas/launch.json"],
  ["tools", "tools/certificate.exe"], ["lockfile", "package-lock.json"],
] as const).map(([role, path]) => ({ role, path, bytes: Buffer.from(path) })) satisfies SourceClosureFile[];

test("launcher independently verifies and rolls back a source update that fails before mutation acceptance", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-cli-update-"));
  const release = publishImmutableSourceClosure({ releasesDirectory: join(root, "releases"), plan: {
    schemaVersion: 1, trustClass: "local-source", inputMode: "source-build",
    node: { version: "24.13.0", architecture: "x64" }, nodeApi: 10,
    pi: { version: "0.80.10", integrity: "sha512-pinned" },
    toolchain: { msvc: "19.44", windowsSdk: "10.0.26100.0", cmake: "4.0.0", cpp: "20" },
    sourceIdentity: "git:next", files,
  } });
  const events: string[] = [];

  await assert.rejects(activateSourceUpdate({
    releasesDirectory: join(root, "releases"), expectedInstanceId: "instance-1",
    expectedOwningSid: "S-1-5-21-1", peer: { instanceId: "instance-1", owningSid: "S-1-5-21-1" },
    candidate: { releaseId: release.releaseId, closureSha256: release.releaseId.slice(7) },
    hooks: {
      verifyCompatibility: () => { events.push("compatible"); }, stopAcceptingMutations: () => { events.push("drain"); },
      isQuiescent: () => true, prepareMigration: async () => { events.push("migrate"); return () => { events.push("rollback-migration"); }; },
      activateRelease: async () => { events.push("activate"); throw new Error("not ready"); },
      hasAcceptedNewMutations: () => false, resumeAcceptingMutations: () => { events.push("resume"); },
    },
  }), /not ready/);

  assert.deepEqual(events, ["compatible", "drain", "migrate", "activate", "rollback-migration", "resume"]);
});
