import assert from "node:assert/strict";
import test from "node:test";
import { parseResolvedLaunchManifest } from "../packages/launch-manifest/src/index.js";
import {
  composePortableManifestHost,
  type ManifestHostFactories,
} from "../packages/host/src/daemon-composition.js";

const hash = "b".repeat(64);
const root = "C:\\Users\\fixture\\AppData\\Local\\Pidex\\Source\\portable";

function portableManifest() {
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
    identity: { instanceId: "portable", owningSid: "S-1-5-21-1000", trustClass: "source" },
    generations: { release: "r1", daemon: 1, worker: 1, publicProtocol: 1, localControl: 1, capability: 1, addon: 1, schema: 1 },
    endpoints: { canonicalOrigin: "https://portable.invalid:49152", canonicalPort: 49152, localControl: "\\\\.\\pipe\\pidex-portable" },
    roots: { sourceInstance: root, roles }, artifacts,
    piProfile: { policy: "synthetic-isolated", version: "0.80.10" },
    runtimes: { node: { lane: "primary", version: "24.1.0", architecture: "x64", sha256: hash }, nodeApi: 10, pi: { version: "0.80.10", integrity: "sha512-test" }, addonAbi: "napi-10", toolchain: { msvc: "19.44", windowsSdk: "10", cmake: "4", cpp: "20" } },
    compatibility: { daemonWorker: [1], publicProtocol: [1], localControl: [1], capability: [1], addon: [1], schema: [1], piArtifacts: [] },
    closure: { id: "sha256:r1", sbom: { path: `${root}\\releases\\r1\\sbom.json`, sha256: hash } },
    execution: { implementation: "deterministic", evidenceClass: "deterministic-test" },
    provenance: { source: { kind: "default", detail: "portable production-composition fixture" } },
  });
}

function factories(): ManifestHostFactories {
  const owner = () => ({ close: async () => {} });
  return {
    proveLauncherContainment: async () => {},
    openAuthenticatedLocalControl: async () => owner(),
    verifyReleaseAndNativeIdentity: async () => {},
    openAuthority: async () => ({ mode: "normal", ...owner() }),
    probePi: async () => {},
    openLan: async () => owner(),
    openRunAdmission: async () => owner(),
  };
}

test("portable evidence uses the manifest composition root without claiming native containment or real profile access", async () => {
  const host = await composePortableManifestHost(portableManifest(), factories(), {
    substitutedCapabilities: ["windows", "process"],
  });

  assert.deepEqual(host.evidence, {
    tier: "portable",
    substitutedCapabilities: ["windows", "process"],
    nativeContainment: "not-claimed",
    profileAccess: "synthetic-only",
    providerTraffic: "disabled",
  });
  assert.equal(host.health.scope("pi-configuration").availability, "available");
  await host.close();
});

test("portable product smoke fails closed when a real composition component is missing", async () => {
  const incomplete = factories() as Partial<ManifestHostFactories>;
  delete incomplete.probePi;

  await assert.rejects(
    composePortableManifestHost(portableManifest(), incomplete as ManifestHostFactories, {
      substitutedCapabilities: ["windows", "process"],
    }),
    /missing production composition component: probePi/,
  );
});

test("portable composition rejects substitutes outside Windows and process capabilities", async () => {
  await assert.rejects(
    composePortableManifestHost(portableManifest(), factories(), {
      substitutedCapabilities: ["windows", "pi"] as never,
    }),
    /portable composition may substitute only windows and process capabilities/,
  );
});
