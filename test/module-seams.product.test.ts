import assert from "node:assert/strict";
import test from "node:test";
import { ModuleKernel, futureWorkspaceContracts, type ModuleManifest } from "../packages/host/src/module-kernel.js";

const id = "pidex.workspace" as const;
const kind = `${id}/managed-process` as const;
const capability = `${id}/process.start` as const;
const manifest: ModuleManifest = {
  id, version: "1.0.0", hostCompatibility: { major: 1 },
  resourceKinds: [{ name: kind, scope: "workspace" }],
  protocolFamilies: [`${id}/process-v1`], capabilities: [capability],
  storage: [{ name: `${id}/authority`, sqliteNamespace: "pidex_workspace__authority", blobKinds: [`${id}/log`],
    migrations: [{ from: 0, to: 1, migrate() {} }], checkIntegrity() {}, enumerateBackupReferences: () => [],
    applyRetention() {}, validateRestore() {} }],
  diagnostics: [`${id}/process-health`], lifecycleServices: [`${id}/process-jobs`],
  ui: ["destination", "detail", "action", "status", "diagnostic", "timeline-renderer", "interaction-renderer"].map((slot, index) => ({
    id: `${id}/ui-${index}`, slot: slot as ModuleManifest["ui"][number]["slot"], capability,
    projectionType: `${id}/process-projection`,
  })),
};

test("bundled modules use the kernel authority, storage, worker, UI, and future workspace seams", async () => {
  const kernel = new ModuleKernel(1);
  kernel.register(manifest, { commands: { [`${id}/start`]: payload => ({ accepted: payload }) } });
  assert.equal(kernel.manifests.get(id)?.ui.length, 7);
  kernel.ready();
  assert.throws(() => kernel.register(manifest, { commands: {} }), /readiness/);

  const target = kernel.opaqueId(kind);
  assert.match(target, /^pidex\.workspace\/managed-process:[0-9a-f-]+$/);
  const command = { commandId: "c1", deviceId: "device", kind: `${id}/start` as const, target,
    capability, observedRevision: 3, payload: { workspaceId: "workspace-1", locator: "C:\\mutable" } };
  const accepted = await kernel.dispatchWorkerRequest({ correlationId: "worker-1", sessionId: "session-1", workerGeneration: 1, command }, "device");
  assert.equal(accepted.revision, 4);
  assert.equal((await kernel.dispatch(command, "device")).receipt, accepted.receipt);
  await assert.rejects(kernel.dispatch({ ...command, commandId: "c2", deviceId: "other" }, "device"), /authentication/);

  kernel.preserveUnavailable(target, kind, "pidex.workspace@1.0.0", Uint8Array.of(1, 2));
  await assert.rejects(kernel.dispatch({ ...command, commandId: "c3" }, "device"), /unavailable/);
  assert.deepEqual(kernel.preserved.get(target)?.bytes, Uint8Array.of(1, 2));
  assert.deepEqual(futureWorkspaceContracts, {
    terminalAndManagedProcess: "separate-host-owned-job", sessionRelationship: "provenance-only",
    electron: "device-client", tunnel: "transport-adapter", thirdPartyLoader: false,
  });
});
