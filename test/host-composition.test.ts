import assert from "node:assert/strict";
import test from "node:test";
import { parseResolvedLaunchManifest } from "../packages/launch-manifest/src/index.js";
import {
  composeManifestHost,
  HostHealthGraph,
  type HealthFinding,
  type ManifestHostFactories,
} from "../packages/host/src/daemon-composition.js";
import { runHost } from "../packages/host/src/run-host.js";

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

function recordingFactories(
  calls: string[],
  authorityMode: "normal" | "recovery-only",
): ManifestHostFactories {
  const owner = () => ({ close: async () => {} });
  const requiredOwners = {
    openDurability: async () => { calls.push("durability"); return owner(); },
    openWindows: async () => { calls.push("windows"); return owner(); },
    openPiSupervisor: async () => { calls.push("pi-supervisor"); return owner(); },
    openLifecycle: async () => { calls.push("lifecycle"); return owner(); },
    openBackupRecovery: async () => { calls.push("backup-recovery"); return owner(); },
    openModules: async () => { calls.push("modules"); return owner(); },
  };
  return {
    proveLauncherContainment: async () => { calls.push("containment"); },
    openAuthenticatedLocalControl: async () => {
      calls.push("control");
      return owner();
    },
    verifyReleaseAndNativeIdentity: async () => { calls.push("release"); },
    openAuthority: async () => {
      calls.push("authority");
      return { mode: authorityMode, ...owner() };
    },
    probePi: async () => { calls.push("pi"); },
    openLan: async () => {
      calls.push("lan");
      return owner();
    },
    openRunAdmission: async () => {
      calls.push("runs");
      return owner();
    },
    ...requiredOwners,
  };
}

test("manifest Host proves containment and local control before opening Authority or product edges", async () => {
  const calls: string[] = [];
  const host = await composeManifestHost(
    manifest(),
    recordingFactories(calls, "normal"),
  );

  assert.deepEqual(calls, [
    "containment", "control", "release", "authority", "durability", "windows",
    "modules", "lifecycle", "backup-recovery", "pi", "pi-supervisor", "lan", "runs",
  ]);
  assert.equal(host.health.scope("authority").availability, "available");
  await host.close();
});

test("recovery-only Authority keeps authenticated local recovery open without LAN or Run admission", async () => {
  const calls: string[] = [];
  const host = await composeManifestHost(
    manifest(),
    recordingFactories(calls, "recovery-only"),
  );

  assert.deepEqual(calls, [
    "containment", "control", "release", "authority", "durability", "windows",
    "modules", "lifecycle", "backup-recovery",
  ]);
  assert.equal(host.mode, "recovery-only");
  assert.equal(host.health.scope("local-control").availability, "available");
  assert.equal(host.health.scope("lan").availability, "unavailable");
  assert.equal(host.health.scope("pi-execution").availability, "unavailable");
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

test("direct product startup cannot bypass the manifest-only composition root", async () => {
  await assert.rejects(
    runHost("product"),
    /product Host startup requires the verified manifest composition root/,
  );
});

test("a stable finding degrades only its decided service scope and can recover", () => {
  const health = new HostHealthGraph(["lan", "firewall"]);
  health.set("lan", "available", "edge-open");
  health.set("firewall", "available", "canonical-rule");

  health.report({
    code: "firewall-rule-drift",
    scope: "firewall",
    stage: "runtime",
    severity: "warning",
    availability: "degraded",
    retryability: "manual",
    remediation: "Repair the canonical Private-profile firewall rule",
    observedAt: "2026-07-21T12:00:00.000Z",
  });

  assert.deepEqual(health.scope("firewall"), {
    scope: "firewall",
    availability: "degraded",
    freshness: "current",
    code: "firewall-rule-drift",
    stage: "runtime",
    severity: "warning",
    retryability: "manual",
    firstObservedAt: "2026-07-21T12:00:00.000Z",
    latestObservedAt: "2026-07-21T12:00:00.000Z",
    remediation: "Repair the canonical Private-profile firewall rule",
  });
  assert.equal(health.scope("lan").availability, "available");

  health.resolve("firewall", "firewall-rule-drift");
  assert.deepEqual(health.scope("firewall"), {
    scope: "firewall",
    availability: "available",
    freshness: "current",
    code: "canonical-rule",
  });
});

test("Session generation findings are independent and preserve observation history", () => {
  const health = new HostHealthGraph(["authority"]);
  health.set("authority", "available", "normal");
  const workerGenerationLost = {
    code: "worker-generation-lost",
    scope: "session:one:worker",
    stage: "worker",
    severity: "error",
    availability: "unavailable",
    releaseId: "r1",
    configGeneration: 1,
  } as const satisfies Partial<HealthFinding>;

  health.report({
    ...workerGenerationLost,
    retryability: "manual",
    remediation: "Wake the Session to create a new worker generation",
    observedAt: "2026-07-21T12:00:00.000Z",
  });
  health.report({
    ...workerGenerationLost,
    retryability: "automatic",
    remediation: "Retry worker generation readiness",
    observedAt: "2026-07-21T12:00:30.000Z",
    freshness: "stale",
  });

  assert.equal(health.scope("authority").availability, "available");
  assert.deepEqual(health.scope("session:one:worker"), {
    scope: "session:one:worker",
    availability: "unavailable",
    freshness: "stale",
    code: "worker-generation-lost",
    stage: "worker",
    severity: "error",
    retryability: "automatic",
    firstObservedAt: "2026-07-21T12:00:00.000Z",
    latestObservedAt: "2026-07-21T12:00:30.000Z",
    releaseId: "r1",
    configGeneration: 1,
    remediation: "Retry worker generation readiness",
  });
});
