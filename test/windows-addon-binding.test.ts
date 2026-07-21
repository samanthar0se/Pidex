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
      return addonModule();
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

test("storage and diagnostics ports classify coarse facts without widening diagnostic failures", async () => {
  const calls: unknown[] = [];
  const binding = await loadWindowsAddon(fixture(), {
    runtime: { platform: "win32", architecture: "x64", nodeApi: 10 },
    readFile: async () => bytes,
    loadModule: () => addonModule({
      inspectStoragePath: async (path: string) => {
        calls.push(path);
        if (path.includes("unavailable")) throw new Error("private native detail");
        return path.startsWith("\\\\")
          ? { fileSystem: "NTFS", driveType: "remote" }
          : { fileSystem: "ntfs", driveType: "fixed" };
      },
      writeDiagnosticEvent: async () => {
        throw { operation: "ReportEventW", category: "unavailable", domain: "win32", code: 5, retryable: false, detail: "event log unavailable" };
      },
    }),
  });

  assert.deepEqual(await binding.storage.inspectPath({ path: "C:\\Pidex\\authority" }), {
    coverage: "covered",
    fileSystem: "NTFS",
    driveType: "fixed",
  });
  assert.deepEqual(await binding.storage.inspectPath({ path: "\\\\server\\share\\authority" }), {
    coverage: "outside-boundary",
    fileSystem: "NTFS",
    driveType: "remote",
  });
  await assert.rejects(binding.storage.inspectPath({ path: "relative" }), /absolute/i);
  assert.deepEqual(await binding.storage.inspectPath({ path: "C:\\unavailable" }), {
    coverage: "indeterminate",
    driveType: "unknown",
  });
  assert.equal(await binding.diagnostics.writeEvent({ code: "PIDEX_STORAGE_INDETERMINATE", severity: "warning" }), false);
  assert.deepEqual(calls, ["C:\\Pidex\\authority", "\\\\server\\share\\authority", "C:\\unavailable"]);
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
      loadModule: () => addonModule(),
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
      loadModule: () => addonModule({
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
    loadModule: () => addonModule({ descriptor }),
  };
  await assert.rejects(loadWindowsAddon(manifest, dependencies), /releaseId mismatch/);

  descriptor.releaseId = "r1";
  const binding = await loadWindowsAddon(manifest, {
    ...dependencies,
    loadModule: () => addonModule({
      descriptor,
      selfTest: async () => Promise.reject({ operation: "self-test", category: "unavailable", domain: "win32", code: 21, retryable: true, detail: "coarse failure" }),
    }),
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
    exports: addonExports,
    ...overrides,
  };
}

function addonModule(overrides: Record<string, unknown> = {}) {
  return {
    descriptor: addonDescriptor(),
    selfTest: async () => undefined,
    inspectStoragePath: async () => ({ fileSystem: "NTFS", driveType: "fixed" }),
    observeStorageTopology: async () => ({ close: async () => undefined }),
    writeDiagnosticEvent: async () => true,
    inspectCertificate: async () => ({ state: "absent", reasons: [] }),
    installCertificate: async () => undefined,
    removeCertificate: async () => undefined,
    inspectTask: async () => ({ state: "absent", reasons: [] }),
    registerTask: async () => undefined,
    removeTask: async () => undefined,
    inspectFirewallRule: async () => ({ state: "absent", reasons: [] }),
    ensureFirewallRule: async () => undefined,
    removeFirewallRule: async () => undefined,
    snapshotInterfaces: async () => [],
    observeInterfaces: async () => ({ close: async () => undefined }),
    openAdvertisement: async () => ({ close: async () => undefined }),
    spawnContained: async () => ({ processId: 1, close: async () => undefined }),
    ...overrides,
  };
}

const addonExports = [
  "selfTest", "inspectCertificate", "installCertificate", "removeCertificate",
  "inspectTask", "registerTask", "removeTask", "inspectFirewallRule",
  "ensureFirewallRule", "removeFirewallRule", "snapshotInterfaces",
  "observeInterfaces", "openAdvertisement", "spawnContained",
  "inspectStoragePath", "observeStorageTopology", "writeDiagnosticEvent",
];

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
