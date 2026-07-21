import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ContainedMaintenance,
  MAINTENANCE_OPERATIONS,
  policyOwnerForOperation,
} from "../packages/launcher/src/maintenance.js";
import { DurableOperationRouter } from "../packages/launcher/src/operations.js";

test("online backup stays with the daemon while offline Authority work is maintenance-owned", () => {
  assert.equal(policyOwnerForOperation("backup"), "daemon");
  for (const operation of MAINTENANCE_OPERATIONS) {
    assert.equal(policyOwnerForOperation(operation), "maintenance");
  }
  const root = mkdtempSync(join(tmpdir(), "pidex-maintenance-routing-"));
  const router = new DurableOperationRouter(join(root, "operations.jsonl"));
  assert.throws(() => router.accept({
    invocationId: "wrong-owner", policyOwner: "maintenance",
    operation: "backup", argumentsDigest: "aa".repeat(32),
  }, { phase: "accepted", cancellable: false }), /policy-owner-conflict/);
  for (const operation of MAINTENANCE_OPERATIONS) {
    assert.throws(() => router.accept({
      invocationId: `wrong-owner-${operation}`, policyOwner: "daemon",
      operation, argumentsDigest: "aa".repeat(32),
    }, { phase: "accepted", cancellable: false }), /policy-owner-conflict/);
  }
});

test("maintenance authenticates a contained manifest-pinned child and owns Authority exclusively", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-contained-maintenance-"));
  const spawns: unknown[] = [];
  let daemonStopped = false;
  const coordinator = new ContainedMaintenance({
    statePath: join(root, "launcher", "maintenance.json"),
    manifest: {
      instanceId: "instance-1",
      releaseId: "release-1",
      localControlGeneration: 1,
      maintenanceExecutable: "C:\\Pidex\\releases\\release-1\\maintenance.exe",
      workingDirectory: "C:\\Pidex\\Source\\instance-1",
    },
    daemon: {
      isStopped: () => daemonStopped,
    },
    bootstrap: {
      issue: () => ({ handle: 41, nonce: Buffer.from("nonce") }),
      authenticate: (_nonce, identity) => {
        assert.equal(identity.role, "maintenance");
      },
    },
    process: {
      async spawnContained(request) {
        spawns.push(request);
        return { processId: 72, lateFault: new Promise(() => {}), close: async () => {} };
      },
    },
  });

  await assert.rejects(
    coordinator.start({ operationId: "op-1", operation: "restore", secret: "do-not-leak" }),
    /daemon-must-be-stopped/,
  );
  daemonStopped = true;
  const launch = await coordinator.start({ operationId: "op-1", operation: "restore", secret: "do-not-leak" });
  assert.equal(launch.processId, 72);
  assert.equal(spawns.length, 1);
  assert.doesNotMatch(JSON.stringify(spawns), /do-not-leak/);
  assert.match(JSON.stringify(spawns), /maintenance/);
  assert.match(readFileSync(join(root, "launcher", "maintenance.json"), "utf8"), /op-1/);

  await assert.rejects(
    coordinator.start({ operationId: "op-2", operation: "recovery" }),
    /maintenance-already-active/,
  );
  coordinator.authenticate(launch.nonce, {
    processId: 72,
    role: "maintenance",
    instanceId: "instance-1",
    releaseId: "release-1",
    configId: "config-1",
    protocol: "pidex-local-control-v1",
  });
});

test("restart preserves interrupted evidence and never guesses that maintenance succeeded", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-contained-maintenance-"));
  const statePath = join(root, "maintenance.json");
  const options = {
    statePath,
    manifest: {
      instanceId: "instance-1", releaseId: "release-1",
      localControlGeneration: 1, maintenanceExecutable: "C:\\Pidex\\maintenance.exe",
      workingDirectory: "C:\\Pidex",
    },
    daemon: { isStopped: () => true },
    bootstrap: { issue: () => ({ handle: 1, nonce: Buffer.from("n") }), authenticate: () => {} },
    process: { spawnContained: async () => ({ processId: 1, lateFault: new Promise<never>(() => {}), close: async () => {} }) },
  };
  const first = new ContainedMaintenance(options);
  await first.start({ operationId: "op-interrupted", operation: "recovery" });
  const restarted = new ContainedMaintenance(options);
  assert.deepEqual(restarted.reconcile(), {
    operationId: "op-interrupted",
    operation: "recovery",
    state: "interrupted",
    authorityDisposition: "inspect-before-next-mutation",
  });
});
