import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishImmutableSourceClosure, type SourceClosureFile } from "../packages/source/src/source-closure.js";
import { prepareSourceInstance } from "../packages/source/src/source-instance.js";
import { startSourceRelease, updateSourceRelease, rollbackSourceRelease } from "../packages/source/src/source-launch.js";

const files = (label: string) => ([
  ["runtime", "runtime/node.exe"], ["emitted-code", "app/daemon.js"],
  ["dependencies", "app/node_modules/zod/index.js"],
  ["pi", "app/node_modules/@earendil-works/pi-coding-agent/index.js"],
  ["companion", "app/companion.js"], ["addon", "native/pidex_windows.node"],
  ["launcher", "native/pidex-launcher.exe"], ["schemas", "schemas/launch.json"],
  ["tools", "tools/certificate.exe"], ["lockfile", "package-lock.json"],
] as const).map(([role, path]) => ({ role, path, bytes: Buffer.from(`${label}:${path}`) })) satisfies SourceClosureFile[];

function plan(label: string) {
  return {
    schemaVersion: 1 as const, trustClass: "local-source" as const,
    inputMode: "source-build" as const,
    node: { version: "24.1.0", architecture: "x64" as const }, nodeApi: 10,
    pi: { version: "0.80.10" as const, integrity: "sha512-pinned" },
    toolchain: { msvc: "19.44", windowsSdk: "10.0.26100.0", cmake: "4.0.0", cpp: "20" as const },
    sourceIdentity: label, files: files(label),
  };
}

test("two checkouts start, update, and roll back only through their stable stopped launcher", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-launch-"));
  const profileDirectory = join(root, "profile");
  const integrationCalls: string[] = [];
  const prepare = (checkoutDirectory: string) => prepareSourceInstance({
    checkoutDirectory, profileDirectory,
    identity: { owningSid: "S-1-5-21-100", tokenSid: "S-1-5-21-100", administrator: true, elevated: true, appContainer: false },
    integrations: {
      ensureCertificate: async () => { integrationCalls.push("certificate"); return { changed: false, inspection: { state: "matches", reasons: [] } }; },
      ensureFirewallRule: async () => { integrationCalls.push("firewall"); return { changed: false, inspection: { state: "matches", reasons: [] } }; },
    },
    createTlsMaterial: async () => ({ caCertificate: "ca", caPrivateKey: "ca-key", hostCertificate: "host", hostPrivateKey: "host-key" }),
  });
  const first = await prepare(join(root, "first"));
  const second = await prepare(join(root, "second"));
  const oldRelease = publishImmutableSourceClosure({ releasesDirectory: join(first.sourceRoot, "releases"), plan: plan("old") });
  const nextRelease = publishImmutableSourceClosure({ releasesDirectory: join(first.sourceRoot, "releases"), plan: plan("next") });
  const secondRelease = publishImmutableSourceClosure({ releasesDirectory: join(second.sourceRoot, "releases"), plan: plan("second") });
  const invocations: Array<{ launcher: string; releaseId: string }> = [];
  const runtime = {
    isLauncherStopped: async () => true,
    inspectCanonicalOrigin: async () => "available" as const,
    invokeStableLauncher: async (launcher: string, releaseId: string) => { invocations.push({ launcher, releaseId }); },
  };

  await startSourceRelease({ checkoutDirectory: join(root, "first"), profileDirectory, owningSid: "S-1-5-21-100", releaseDirectory: oldRelease.directory, runtime });
  await updateSourceRelease({ checkoutDirectory: join(root, "first"), profileDirectory, owningSid: "S-1-5-21-100", releaseDirectory: nextRelease.directory, runtime });
  await rollbackSourceRelease({ checkoutDirectory: join(root, "first"), profileDirectory, owningSid: "S-1-5-21-100", runtime });
  await startSourceRelease({ checkoutDirectory: join(root, "second"), profileDirectory, owningSid: "S-1-5-21-100", releaseDirectory: secondRelease.directory, runtime });

  assert.deepEqual(invocations.map(item => item.releaseId), [oldRelease.releaseId, nextRelease.releaseId, oldRelease.releaseId, secondRelease.releaseId]);
  assert.notEqual(invocations[0]!.launcher, invocations[3]!.launcher);
  assert.equal(readFileSync(invocations[0]!.launcher, "utf8"), "old:native/pidex-launcher.exe");
  assert.equal(integrationCalls.length, 4, "start/update/rollback perform no preparation repair");
  assert.equal(existsSync(join(first.sourceRoot, "control", "control.key")), true);
});

test("start rejects fixed-origin collision before changing launcher selection", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-launch-"));
  const checkoutDirectory = join(root, "checkout");
  const profileDirectory = join(root, "profile");
  const prepared = await prepareSourceInstance({
    checkoutDirectory, profileDirectory,
    identity: { owningSid: "S-1-5-21-100", tokenSid: "S-1-5-21-100", administrator: true, elevated: true, appContainer: false },
    integrations: {
      ensureCertificate: async () => ({ changed: false, inspection: { state: "matches", reasons: [] } }),
      ensureFirewallRule: async () => ({ changed: false, inspection: { state: "matches", reasons: [] } }),
    },
    createTlsMaterial: async () => ({ caCertificate: "ca", caPrivateKey: "ca-key", hostCertificate: "host", hostPrivateKey: "host-key" }),
  });
  const release = publishImmutableSourceClosure({ releasesDirectory: join(prepared.sourceRoot, "releases"), plan: plan("collision") });

  await assert.rejects(startSourceRelease({
    checkoutDirectory, profileDirectory, owningSid: "S-1-5-21-100", releaseDirectory: release.directory,
    runtime: { isLauncherStopped: async () => true, inspectCanonicalOrigin: async () => "collision" as const, invokeStableLauncher: async () => assert.fail("must not invoke") },
  }), /fixed canonical origin collision/i);
  assert.equal(existsSync(join(prepared.sourceRoot, "launcher", "active-release")), false);
});

test("update cannot replace the stable launcher while it is running", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-launch-"));
  const checkoutDirectory = join(root, "checkout");
  const profileDirectory = join(root, "profile");
  const prepared = await prepareSourceInstance({
    checkoutDirectory, profileDirectory,
    identity: { owningSid: "S-1-5-21-100", tokenSid: "S-1-5-21-100", administrator: true, elevated: true, appContainer: false },
    integrations: {
      ensureCertificate: async () => ({ changed: false, inspection: { state: "matches", reasons: [] } }),
      ensureFirewallRule: async () => ({ changed: false, inspection: { state: "matches", reasons: [] } }),
    },
    createTlsMaterial: async () => ({ caCertificate: "ca", caPrivateKey: "ca-key", hostCertificate: "host", hostPrivateKey: "host-key" }),
  });
  const release = publishImmutableSourceClosure({ releasesDirectory: join(prepared.sourceRoot, "releases"), plan: plan("running") });

  await assert.rejects(updateSourceRelease({
    checkoutDirectory, profileDirectory, owningSid: "S-1-5-21-100", releaseDirectory: release.directory,
    runtime: { isLauncherStopped: async () => false, inspectCanonicalOrigin: async () => assert.fail("must not inspect"), invokeStableLauncher: async () => assert.fail("must not invoke") },
  }), /only while stopped/i);
  assert.equal(existsSync(join(prepared.sourceRoot, "launcher", "pidex-launcher.exe")), false);
});
