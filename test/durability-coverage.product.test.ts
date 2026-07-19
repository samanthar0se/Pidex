import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  adaptersFor,
  type StorageClassification,
} from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { clientHello } from "../packages/protocol/src/status.js";
import { nextControlMessage } from "./control-client.js";

test("Durability coverage is asynchronous, role-specific, conservative, and privacy-safe", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-coverage-secret-"));
  const installationDir = join(dataDir, "private-installation");
  const checkpointDir = join(dataDir, "private-checkpoints");
  const adapters = adaptersFor("deterministic");
  const resolvers = new Map<
    string,
    {
      resolve: (facts: StorageClassification) => void;
      reject: (error: Error) => void;
    }
  >();
  adapters.windows.classifyStorageRoot = path =>
    new Promise((resolve, reject) => resolvers.set(path, { resolve, reject }));
  const resolveStorage = (path: string, facts: StorageClassification): void => {
    const resolver = resolvers.get(path);
    assert.ok(resolver, "expected a pending storage classification");
    resolver.resolve(facts);
  };
  const host = await startHost({
    dataDir,
    installationDir,
    piCheckpointDir: checkpointDir,
    port: 0,
    authorization: "device",
    adapters,
  });

  try {
    const pending = host.status();
    assert.equal(pending.readiness, "ready");
    assert.equal(pending.durability.assessment, "assessment-pending");

    const socket = new WebSocket(
      `${host.origin.replace("https:", "wss:")}/control`,
      {
        rejectUnauthorized: false,
        headers: { authorization: "Bearer device" },
      },
    );
    const offer = await nextControlMessage(socket);
    assert.equal(offer.type, "host.hello");
    if (offer.type !== "host.hello") {
      throw new Error("expected offer");
    }
    socket.send(JSON.stringify(clientHello(offer.hostId)));
    assert.equal((await nextControlMessage(socket)).type, "protocol.admitted");
    assert.equal((await nextControlMessage(socket)).type, "host.snapshot");

    resolveStorage(dataDir, { fileSystem: "NTFS", driveType: "fixed" });
    resolveStorage(installationDir, {
      fileSystem: "ReFS",
      driveType: "fixed",
    });
    resolvers
      .get(checkpointDir)
      ?.reject(new Error("classification unavailable"));
    const change = await nextControlMessage(socket);
    assert.equal(change.type, "durability.coverage-changed");
    if (change.type !== "durability.coverage-changed") {
      throw new Error("expected coverage");
    }
    assert.equal(change.coverage.aggregate, "outside-boundary");
    assert.deepEqual(change.coverage.roles.map(({ role, state }) => ({ role, state })), [
      { role: "host-data", state: "covered" },
      { role: "installation-release", state: "outside-boundary" },
      { role: "pi-checkpoint", state: "indeterminate" },
    ]);
    assert.equal(change.warnings.length, 2);
    assert.equal(JSON.stringify(change).includes(dataDir), false);
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
