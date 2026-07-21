import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeResolvedLaunchManifest,
  parseResolvedLaunchManifest,
} from "../packages/launch-manifest/src/index.js";

const hash = "a".repeat(64);
const root = "C:\\Users\\owner\\AppData\\Local\\Pidex\\Source\\instance-1";

function createManifestFixture(): unknown {
  const roots = Object.fromEntries(
    [
      "instanceIdentity",
      "controlCredential",
      "authorityGenerations",
      "generationSelectors",
      "immutableBlobs",
      "checkpointChunks",
      "checkpointManifests",
      "workerState",
      "migrationStaging",
      "recoverySnapshots",
      "managedBackups",
      "diagnostics",
      "launcherState",
      "tlsState",
      "publicationTemp",
    ].map((role) => [role, `${root}\\${role}`]),
  );
  const artifacts = Object.fromEntries(
    [
      "launcher",
      "node",
      "daemon",
      "worker",
      "addon",
      "companion",
      "schemas",
      "certificateTool",
      "maintenance",
    ].map((role, index) => [
      role,
      {
        path: `${root}\\releases\\r1\\${index}.bin`,
        sha256: hash,
      },
    ]),
  );
  return {
    schemaVersion: 1,
    identity: {
      instanceId: "instance-1",
      owningSid: "S-1-5-21-1",
      trustClass: "source",
    },
    generations: {
      release: "r1",
      daemon: 1,
      worker: 1,
      publicProtocol: 1,
      localControl: 1,
      capability: 1,
      addon: 1,
      schema: 1,
    },
    endpoints: {
      canonicalOrigin: "https://pidex-a.local:47831",
      canonicalPort: 47831,
      localControl: "\\\\.\\pipe\\pidex-instance-1",
    },
    roots: { sourceInstance: root, roles: roots },
    artifacts,
    piProfile: { policy: "owning-user-standard", version: "0.80.10" },
    runtimes: {
      node: { version: "24.1.0", architecture: "x64", sha256: hash },
      nodeApi: 10,
      pi: { version: "0.80.10", integrity: "sha512-test" },
      addonAbi: "napi-10",
      toolchain: {
        msvc: "19.44",
        windowsSdk: "10.0.26100.0",
        cmake: "4.0.0",
        cpp: "20",
      },
    },
    compatibility: {
      daemonWorker: [1],
      publicProtocol: [1],
      localControl: [1],
      capability: [1],
      addon: [1],
      schema: [1],
      piArtifacts: [{ from: 1, to: 1, converterArtifact: "maintenance" }],
    },
    closure: {
      id: "sha256:r1",
      sbom: { path: `${root}\\releases\\r1\\sbom.json`, sha256: hash },
    },
    execution: { implementation: "real", evidenceClass: "local-source" },
    provenance: {
      source: { kind: "default", detail: "source config defaults" },
      canonicalPort: { kind: "default", detail: "fixed product port" },
    },
  };
}

test("canonical serialization is independent of object key insertion order", () => {
  const manifest = parseResolvedLaunchManifest(createManifestFixture());
  const reorderedManifest = structuredClone(manifest);
  reorderedManifest.provenance = Object.fromEntries(
    Object.entries(reorderedManifest.provenance).reverse(),
  );

  assert.equal(
    canonicalizeResolvedLaunchManifest(manifest),
    canonicalizeResolvedLaunchManifest(reorderedManifest),
  );
});

test("unknown manifest fields are rejected", () => {
  const manifest = parseResolvedLaunchManifest(createManifestFixture());
  assert.throws(
    () => parseResolvedLaunchManifest({ ...manifest, secret: "no" }),
    /Unrecognized key|unknown/i,
  );
});

test("relative artifact paths are rejected", () => {
  const manifest = parseResolvedLaunchManifest(createManifestFixture());
  manifest.artifacts.node.path = "node.exe";
  assert.throws(() => parseResolvedLaunchManifest(manifest), /absolute/i);
});

test("root roles cannot cross outside the selected source instance", () => {
  const manifest = parseResolvedLaunchManifest(createManifestFixture());
  manifest.roots.roles.tlsState =
    "C:\\Users\\owner\\AppData\\Local\\Pidex\\Installed\\tls";
  assert.throws(() => parseResolvedLaunchManifest(manifest), /crossover/i);
});

test("deterministic execution rejects product manifest settings", () => {
  const manifest = parseResolvedLaunchManifest(createManifestFixture());
  manifest.execution.implementation = "deterministic";
  assert.throws(() => parseResolvedLaunchManifest(manifest), /deterministic/i);
});

test("the trust class must match the selected profile root", () => {
  const manifest = parseResolvedLaunchManifest(createManifestFixture());
  manifest.identity.trustClass = "installed";
  assert.throws(() => parseResolvedLaunchManifest(manifest), /trust class/i);
});
