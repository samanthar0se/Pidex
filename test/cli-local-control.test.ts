import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  CliControlClient,
  projectStatus,
  resolveCliTarget,
  type LocalControlTransport,
} from "../packages/cli/src/local-control.js";

function makeRunningReceipt(invocationId: string, operationId: string) {
  return { invocationId, operationId, phase: "copy", state: "running", cancellable: true } as const;
}

test("CLI resolves exactly the explicit manifest or checkout source marker without fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-cli-target-"));
  const checkout = join(root, "checkout");
  const profile = join(root, "profile");
  await mkdir(checkout);
  await writeFile(join(checkout, ".pidex-source-instance.json"), JSON.stringify({
    schemaVersion: 1,
    instanceId: "instance-one",
  }));

  assert.deepEqual(resolveCliTarget({ checkoutDirectory: checkout, profileDirectory: profile }), {
    trustClass: "source",
    instanceId: "instance-one",
    manifestPath: resolve(profile, "Pidex", "Source", "instance-one", "launcher", "resolved-launch-manifest.json"),
  });
  assert.throws(
    () => resolveCliTarget({ checkoutDirectory: join(root, "other"), profileDirectory: profile }),
    /explicit target or prepared checkout marker/,
  );
  assert.throws(
    () => resolveCliTarget({ explicitManifestPath: "relative.json", checkoutDirectory: checkout, profileDirectory: profile }),
    /absolute/,
  );
});

test("status projects launcher state with fresh or explicitly stale daemon health and stable exits", async () => {
  const fresh = projectStatus({
    launcher: { state: "ready", attempts: 1 },
    daemon: { freshness: "current", mode: "normal", health: [
      { scope: "lan", availability: "degraded", freshness: "current", code: "no-private-interface" },
    ] },
  });
  assert.equal(fresh.exit, "degraded");
  assert.match(fresh.human, /DEGRADED.*lan.*no-private-interface/);
  assert.equal(fresh.json.daemon?.freshness, "current");

  const stopped = projectStatus({
    launcher: { state: "stopped", attempts: 0 },
    daemon: { freshness: "stale", mode: "normal", health: [] },
  });
  assert.equal(stopped.exit, "unavailable");
  assert.match(stopped.human, /STALE daemon observation/);
});

test("ambiguous operation delivery looks up one invocation receipt and reconnect follow preserves it", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  let disconnected = false;
  const receipt = makeRunningReceipt("inv-1", "op-1");
  const transport: LocalControlTransport = {
    async request(method, payload) {
      calls.push({ method, payload });
      if (method === "operation.invoke" && !disconnected) {
        disconnected = true;
        throw new Error("connection lost after delivery");
      }
      if (method === "operation.lookup-invocation") return receipt;
      if (method === "operation.follow") return { receipt: { ...receipt, state: "succeeded", cancellable: false }, progress: [] };
      throw new Error(`unexpected ${method}`);
    },
  };
  const client = new CliControlClient(transport, () => "inv-1");
  const accepted = await client.invoke({ policyOwner: "maintenance", operation: "restore", argumentsDigest: "ab".repeat(32) });
  assert.deepEqual(accepted, receipt);
  assert.equal((await client.follow(accepted.operationId)).receipt.invocationId, "inv-1");
  assert.deepEqual(calls.map(call => call.method), ["operation.invoke", "operation.lookup-invocation", "operation.follow"]);
});

test("detach and Ctrl+C preserve the accepted receipt while cancel is an explicit operation", async () => {
  const receipt = makeRunningReceipt("inv-2", "op-2");
  const methods: string[] = [];
  const transport: LocalControlTransport = { async request(method) {
    methods.push(method);
    if (method === "operation.invoke") return receipt;
    if (method === "operation.cancel") return { ...receipt, state: "cancelled", cancellable: false };
    throw new Error("follow disconnected");
  } };
  const client = new CliControlClient(transport, () => "inv-2");
  const detached = await client.run(
    { policyOwner: "maintenance", operation: "restore", argumentsDigest: "cd".repeat(32) },
    { detach: true },
  );
  assert.deepEqual(detached, { receipt, detached: true, progress: [] });
  assert.equal((await client.cancel("op-2", "copy")).state, "cancelled");
  assert.deepEqual(methods, ["operation.invoke", "operation.cancel"]);
});

test("source update publishes first and submits only its content identity to the launcher", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const receipt = makeRunningReceipt("inv-update", "op-update");
  const transport: LocalControlTransport = { async request(method, payload) {
    calls.push({ method, payload });
    return receipt;
  } };
  const client = new CliControlClient(transport, () => "inv-update");

  const result = await client.activateSourceUpdate({
    releaseId: `sha256-${"a".repeat(64)}`,
    closureSha256: "a".repeat(64),
  });

  assert.deepEqual(result, receipt);
  assert.deepEqual(calls, [{
    method: "source-update.activate",
    payload: {
      invocationId: "inv-update",
      releaseId: `sha256-${"a".repeat(64)}`,
      closureSha256: "a".repeat(64),
    },
  }]);
});
