import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseResolvedLaunchManifest } from "../packages/launch-manifest/src/index.js";
import { loadWindowsAddon, WindowsPlatformError } from "../packages/windows/src/index.js";

const bytes = Buffer.from("candidate addon");
const digest = createHash("sha256").update(bytes).digest("hex");
const root = "C:\\Users\\owner\\AppData\\Local\\Pidex\\Source\\instance-1";

test("the Windows binding validates the manifest-selected addon before exposing async ports", async () => {
  const manifest = fixture();
  let loads = 0;
  const binding = await loadWindowsAddon(manifest, {
    runtime: { platform: "win32", architecture: "x64", nodeApi: 10 },
    readFile: async path => {
      assert.equal(path, manifest.artifacts.addon.path);
      return bytes;
    },
    loadModule: path => {
      loads += 1;
      assert.equal(path, manifest.artifacts.addon.path);
      return {
        descriptor: addonDescriptor(),
        selfTest: async () => undefined,
      };
    },
  });

  await binding.selfTest();
  assert.equal(loads, 1);

  await assert.rejects(
    loadWindowsAddon(
      { ...manifest, artifacts: { ...manifest.artifacts, addon: { ...manifest.artifacts.addon, sha256: "a".repeat(64) } } },
      {
        runtime: { platform: "win32", architecture: "x64", nodeApi: 10 },
        readFile: async () => bytes,
        loadModule: () => {
          assert.fail("a hash mismatch must be rejected before addon loading");
        },
      },
    ),
    /hash/i,
  );
});

test("the Windows binding rejects an addon artifact that changes while it is loading", async () => {
  const manifest = fixture();
  let reads = 0;

  await assert.rejects(
    loadWindowsAddon(manifest, {
      runtime: { platform: "win32", architecture: "x64", nodeApi: 10 },
      readFile: async () => {
        reads += 1;
        return reads === 1 ? bytes : Buffer.from("replacement addon");
      },
      loadModule: () => ({
        descriptor: addonDescriptor(),
        selfTest: async () => undefined,
      }),
    }),
    /changed while loading/i,
  );
});

test("the Windows binding rejects native exports that are absent from the descriptor", async () => {
  const manifest = fixture();

  await assert.rejects(
    loadWindowsAddon(manifest, {
      runtime: { platform: "win32", architecture: "x64", nodeApi: 10 },
      readFile: async () => bytes,
      loadModule: () => ({
        descriptor: addonDescriptor(),
        selfTest: async () => undefined,
        undeclared: () => undefined,
      }),
    }),
    /exports mismatch/i,
  );
});

test("the Windows binding rejects incompatible addon identity and maps stable native errors", async () => {
  const manifest = fixture();
  const descriptor = addonDescriptor({ releaseId: "wrong-release" });
  const dependencies = {
    runtime: { platform: "win32", architecture: "x64", nodeApi: 10 },
    readFile: async () => bytes,
    loadModule: () => ({ descriptor, selfTest: async () => undefined }),
  };
  await assert.rejects(loadWindowsAddon(manifest, dependencies), /releaseId mismatch/);

  descriptor.releaseId = "r1";
  const binding = await loadWindowsAddon(manifest, {
    ...dependencies,
    loadModule: () => ({ descriptor, selfTest: async () => Promise.reject({ operation: "self-test", category: "unavailable", domain: "win32", code: 21, retryable: true, detail: "coarse failure" }) }),
  });
  await assert.rejects(binding.selfTest(), error => {
    assert.ok(error instanceof WindowsPlatformError);
    assert.deepEqual(
      { operation: error.operation, category: error.category, domain: error.domain, code: error.code, retryable: error.retryable, detail: error.detail },
      { operation: "self-test", category: "unavailable", domain: "win32", code: 21, retryable: true, detail: "coarse failure" },
    );
    return true;
  });
});

function addonDescriptor(overrides: { releaseId?: string } = {}) {
  return {
    schemaVersion: 1,
    architecture: "x64",
    nodeApi: 10,
    abi: "napi-10",
    addonGeneration: 1,
    schemaGeneration: 1,
    releaseId: "r1",
    exports: ["selfTest"],
    ...overrides,
  };
}

function fixture() {
  const roles = Object.fromEntries(
    ["instanceIdentity", "controlCredential", "authorityGenerations", "generationSelectors", "immutableBlobs", "checkpointChunks", "checkpointManifests", "workerState", "migrationStaging", "recoverySnapshots", "managedBackups", "diagnostics", "launcherState", "tlsState", "publicationTemp"].map(role => [role, `${root}\\${role}`]),
  );
  const artifacts = Object.fromEntries(
    ["launcher", "node", "daemon", "worker", "addon", "companion", "schemas", "certificateTool", "maintenance"].map((role, index) => [role, { path: `${root}\\releases\\r1\\${index}.bin`, sha256: role === "addon" ? digest : "a".repeat(64) }]),
  );
  return parseResolvedLaunchManifest({
    schemaVersion: 1,
    identity: { instanceId: "instance-1", owningSid: "S-1-5-21-1", trustClass: "source" },
    generations: { release: "r1", daemon: 1, worker: 1, publicProtocol: 1, localControl: 1, capability: 1, addon: 1, schema: 1 },
    endpoints: { canonicalOrigin: "https://pidex.local:47831", canonicalPort: 47831, localControl: "\\\\.\\pipe\\pidex-instance-1" },
    roots: { sourceInstance: root, roles }, artifacts,
    piProfile: { policy: "owning-user-standard", version: "0.80.10" },
    runtimes: { node: { lane: "primary", version: "24.18.0", architecture: "x64", sha256: "a".repeat(64) }, nodeApi: 10, pi: { version: "0.80.10", integrity: "sha512-test" }, addonAbi: "napi-10", toolchain: { msvc: "19.44", windowsSdk: "10.0.26100.0", cmake: "4.3.3", cpp: "20" } },
    compatibility: { daemonWorker: [1], publicProtocol: [1], localControl: [1], capability: [1], addon: [1], schema: [1], piArtifacts: [] },
    closure: { id: "closure-r1", sbom: { path: `${root}\\releases\\r1\\sbom.json`, sha256: "a".repeat(64) } },
    execution: { implementation: "real", evidenceClass: "local-source" }, provenance: {},
  });
}
