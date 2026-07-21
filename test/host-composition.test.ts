import assert from "node:assert/strict";
import test from "node:test";
import { parseResolvedLaunchManifest } from "../packages/launch-manifest/src/index.js";
import { composeManifestHost } from "../packages/host/src/daemon-composition.js";

const hash = "a".repeat(64);
const root = "C:\\Users\\owner\\AppData\\Local\\Pidex\\Source\\instance-1";

function manifest() {
  const roles = Object.fromEntries([
    "instanceIdentity", "controlCredential", "authorityGenerations", "generationSelectors",
    "immutableBlobs", "checkpointChunks", "checkpointManifests", "workerState",
    "migrationStaging", "recoverySnapshots", "managedBackups", "diagnostics",
    "launcherState", "tlsState", "publicationTemp",
  ].map(role => [role, `${root}\\${role}`]));
  const artifacts = Object.fromEntries([
    "launcher", "node", "daemon", "worker", "addon", "companion", "schemas",
    "certificateTool", "maintenance",
  ].map((role, index) => [role, { path: `${root}\\releases\\r1\\${index}.bin`, sha256: hash }]));
  return parseResolvedLaunchManifest({
    schemaVersion: 1,
    identity: { instanceId: "instance-1", owningSid: "S-1-5-21-1", trustClass: "source" },
    generations: { release: "r1", daemon: 1, worker: 1, publicProtocol: 1, localControl: 1, capability: 1, addon: 1, schema: 1 },
    endpoints: { canonicalOrigin: "https://pidex-a.local:47831", canonicalPort: 47831, localControl: "\\\\.\\pipe\\pidex-instance-1" },
    roots: { sourceInstance: root, roles }, artifacts,
    piProfile: { policy: "owning-user-standard", version: "0.80.10" },
    runtimes: { node: { lane: "primary", version: "24.1.0", architecture: "x64", sha256: hash }, nodeApi: 10, pi: { version: "0.80.10", integrity: "sha512-test" }, addonAbi: "napi-10", toolchain: { msvc: "19.44", windowsSdk: "10", cmake: "4", cpp: "20" } },
    compatibility: { daemonWorker: [1], publicProtocol: [1], localControl: [1], capability: [1], addon: [1], schema: [1], piArtifacts: [] },
    closure: { id: "sha256:r1", sbom: { path: `${root}\\releases\\r1\\sbom.json`, sha256: hash } },
    execution: { implementation: "real", evidenceClass: "local-source" }, provenance: { source: { kind: "default", detail: "test" } },
  });
}

test("manifest Host proves containment and local control before opening Authority or product edges", async () => {
  const calls: string[] = [];
  const host = await composeManifestHost(manifest(), {
    proveLauncherContainment: async () => { calls.push("containment"); },
    openAuthenticatedLocalControl: async () => { calls.push("control"); return { close: async () => {} }; },
    verifyReleaseAndNativeIdentity: async () => { calls.push("release"); },
    openAuthority: async () => { calls.push("authority"); return { mode: "normal", close: async () => {} }; },
    probePi: async () => { calls.push("pi"); },
    openLan: async () => { calls.push("lan"); return { close: async () => {} }; },
    openRunAdmission: async () => { calls.push("runs"); return { close: async () => {} }; },
  });

  assert.deepEqual(calls, ["containment", "control", "release", "authority", "pi", "lan", "runs"]);
  assert.equal(host.health.scope("authority").availability, "available");
  await host.close();
});

test("recovery-only Authority keeps authenticated local recovery open without LAN or Run admission", async () => {
  const calls: string[] = [];
  const host = await composeManifestHost(manifest(), {
    proveLauncherContainment: async () => { calls.push("containment"); },
    openAuthenticatedLocalControl: async () => { calls.push("control"); return { close: async () => {} }; },
    verifyReleaseAndNativeIdentity: async () => { calls.push("release"); },
    openAuthority: async () => { calls.push("authority"); return { mode: "recovery-only", close: async () => {} }; },
    probePi: async () => { calls.push("pi"); },
    openLan: async () => { calls.push("lan"); return { close: async () => {} }; },
    openRunAdmission: async () => { calls.push("runs"); return { close: async () => {} }; },
  });

  assert.deepEqual(calls, ["containment", "control", "release", "authority"]);
  assert.equal(host.mode, "recovery-only");
  assert.equal(host.health.scope("local-control").availability, "available");
  assert.equal(host.health.scope("lan").availability, "unavailable");
  await host.close();
});

test("product composition cannot select deterministic manifests", async () => {
  const deterministic = structuredClone(manifest());
  deterministic.execution.implementation = "deterministic";
  deterministic.execution.evidenceClass = "deterministic-test";
  deterministic.piProfile.policy = "synthetic-isolated";
  deterministic.endpoints.canonicalPort = 12345;
  await assert.rejects(
    composeManifestHost(deterministic, {} as never),
    /real resolved launch manifest/,
  );
});
