import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeResolvedLaunchManifest,
  parseResolvedLaunchManifest,
  verifyImmutableClosure,
  type ClosureReader,
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
      node: {
        lane: "primary",
        version: "24.1.0",
        architecture: "x64",
        sha256: hash,
      },
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

test("immutable closure verification fails closed and emits reproducible lane evidence", async () => {
  const manifest = parseResolvedLaunchManifest(createManifestFixture());
  const declared = [
    ...Object.values(manifest.artifacts),
    manifest.closure.sbom,
  ];
  const files = new Map(
    declared.map(artifact => [artifact.path.toLowerCase(), Buffer.from("x")]),
  );
  for (const artifact of declared) artifact.sha256 =
    "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
  manifest.runtimes.node.sha256 = manifest.artifacts.node.sha256;

  const reader = (overrides: Partial<ClosureReader> = {}): ClosureReader => ({
    listFiles: async () => [...files.keys()],
    readFile: async path => files.get(path.toLowerCase())!,
    isImmutable: async () => true,
    ...overrides,
  });
  const first = await verifyImmutableClosure(manifest, reader());
  const second = await verifyImmutableClosure(manifest, reader());
  assert.deepEqual(first, second);
  assert.equal(first.node.lane, "primary");
  assert.equal(first.pi.version, "0.80.10");

  const secondary = structuredClone(manifest);
  secondary.runtimes.node.lane = "secondary";
  assert.equal(
    (await verifyImmutableClosure(secondary, reader())).node.lane,
    "secondary",
  );

  await assert.rejects(
    verifyImmutableClosure(manifest, reader({ listFiles: async () => [] })),
    /missing/i,
  );
  await assert.rejects(
    verifyImmutableClosure(manifest, reader({
      listFiles: async () => [...files.keys(), `${root}\\releases\\r1\\extra.dll`],
    })),
    /undeclared/i,
  );
  await assert.rejects(
    verifyImmutableClosure(manifest, reader({ isImmutable: async () => false })),
    /mutable/i,
  );
  await assert.rejects(
    verifyImmutableClosure(manifest, reader({ readFile: async () => Buffer.from("wrong") })),
    /hash/i,
  );
});

test("exact Pi, architecture, addon ABI, and generation lanes fail closed", () => {
  const mutations: Array<[string, (manifest: ReturnType<typeof parseResolvedLaunchManifest>) => void]> = [
    ["Pi", manifest => { manifest.runtimes.pi.version = "0.80.11"; }],
    ["architecture", manifest => {
      (manifest.runtimes.node as { architecture: string }).architecture = "arm64";
    }],
    ["Node-API", manifest => { manifest.runtimes.addonAbi = "napi-9"; }],
    ["generation", manifest => { manifest.compatibility.schema = [2]; }],
  ];
  for (const [expected, mutate] of mutations) {
    const manifest = parseResolvedLaunchManifest(createManifestFixture());
    mutate(manifest);
    assert.throws(() => parseResolvedLaunchManifest(manifest), new RegExp(expected, "i"));
  }
});
