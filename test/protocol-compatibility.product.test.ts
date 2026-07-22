import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { unsupportedRequiredSemantics } from "../packages/protocol/src/status.js";
import {
  controlWebSocketUrl,
  nextControlMessage,
  synchronizeEmptyControlScope,
} from "./control-client.js";

function socket(origin: string): WebSocket {
  return new WebSocket(controlWebSocketUrl(origin), {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer device" },
  });
}

test("Anonymous Client hello and admission expose continuity without peer identity", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-anonymous-protocol-"));
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters: adaptersFor("deterministic"),
  });
  try {
    const client = socket(host.origin);
    const offer = await nextControlMessage(client);
    assert.equal(offer.type, "host.hello");
    if (offer.type !== "host.hello") assert.fail("expected Host hello");
    assert.equal(offer.synchronizationEpoch, host.status().synchronization.epoch);
    assert.deepEqual(Object.keys(offer).sort(), [
      "capabilities",
      "hostId",
      "protocols",
      "synchronizationEpoch",
      "type",
    ]);

    client.send(JSON.stringify({
      type: "client.hello",
      protocols: [{ major: 1, minor: 2 }],
      capabilities: offer.capabilities.map(item => ({
        id: item.id,
        minVersion: item.version,
        maxVersion: item.version,
      })),
    }));
    assert.equal((await nextControlMessage(client)).type, "protocol.admitted");
    client.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test(
  "protocol negotiation binds Host identity, admits exact protocol 1.2, and fails closed for incompatible Clients",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pidex-protocol-"));
    const host = await startHost({
      dataDir,
      port: 0,
      authorization: "device",
      adapters: adaptersFor("deterministic"),
    });
    try {
      const compatible = socket(host.origin);
      const offer = await nextControlMessage(compatible);
      assert.equal(offer.type, "host.hello");
      if (offer.type !== "host.hello") {
        return;
      }

      compatible.send(JSON.stringify({
        type: "client.hello",
        expectedHostId: offer.hostId,
        protocols: [{ major: 1, minor: 2 }],
        capabilities: offer.capabilities.map(item => ({
          id: item.id,
          minVersion: item.version,
        })),
        optionalFutureField: true,
      }));
      const admitted = await nextControlMessage(compatible);
      assert.deepEqual(
        admitted.type === "protocol.admitted" && admitted.protocol,
        { major: 1, minor: 2 },
      );
      assert.equal(
        (await nextControlMessage(compatible)).type,
        "host.snapshot",
      );

      const incompatible = socket(host.origin);
      const otherOffer = await nextControlMessage(incompatible);
      assert.equal(otherOffer.type, "host.hello");
      if (otherOffer.type !== "host.hello") {
        return;
      }

      incompatible.send(JSON.stringify({
        type: "client.hello",
        expectedHostId: "host_other",
        protocols: [{ major: 2, minor: 0 }],
        capabilities: [],
      }));
      const required = await nextControlMessage(incompatible);
      assert.equal(required.type, "protocol.update-required");
      assert.equal(
        required.type === "protocol.update-required" && required.reason,
        "host-mismatch",
      );
      assert.equal(await new Promise<number>(resolve => {
        incompatible.once("close", code => resolve(code));
      }), 4008);

      assert.deepEqual(
        unsupportedRequiredSemantics(
          {
            requiredSemantics: [
              "session.created.v1",
              "future.required.v2",
            ],
            optional: { future: true },
          },
          new Set(["session.created.v1"]),
        ),
        ["future.required.v2"],
      );
      compatible.close();
      incompatible.close();
    } finally {
      await host.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);

test("commands remain inadmissible until Anonymous Client synchronization completes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-sync-barrier-"));
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters: adaptersFor("deterministic"),
  });
  try {
    const client = socket(host.origin);
    const offer = await nextControlMessage(client);
    if (offer.type !== "host.hello") assert.fail("expected Host hello");
    client.send(JSON.stringify({
      type: "client.hello",
      protocols: offer.protocols,
      capabilities: offer.capabilities.map(item => ({
        id: item.id,
        version: item.version,
      })),
    }));
    assert.equal((await nextControlMessage(client)).type, "protocol.admitted");
    assert.equal((await nextControlMessage(client)).type, "host.snapshot");

    client.send(JSON.stringify({ type: "session.create", commandId: "before-sync" }));
    const blocked = await nextControlMessage(client);
    assert.equal(blocked.type, "command.outcome");
    assert.equal(blocked.type === "command.outcome" && blocked.error, "synchronization-required");

    client.send(JSON.stringify({
      type: "scope.set",
      protocolVersion: "1.2",
      sessionIds: [],
    }));
    assert.equal((await nextControlMessage(client)).type, "scope.reset");
    client.send(JSON.stringify({ type: "session.create", commandId: "after-sync" }));
    const accepted = await nextControlMessage(client);
    assert.equal(accepted.type, "command.outcome");
    assert.equal(accepted.type === "command.outcome" && accepted.outcome, "accepted");
    client.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test(
  "bounded delivery requests resynchronization before disconnecting the Client",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pidex-delivery-bound-"));
    const host = await startHost({
      dataDir,
      port: 0,
      authorization: "device",
      adapters: adaptersFor("deterministic"),
      maxOutboundBytes: 0,
    });
    try {
      const client = socket(host.origin);
      const closed = new Promise<number>(resolve => {
        client.once("close", code => resolve(code));
      });

      const message = await nextControlMessage(client);
      assert.deepEqual(message, {
        type: "delivery.resynchronize",
        reason: "outbound-queue-overflow",
        lastCursor: host.status().synchronization.cursor,
      });
      assert.equal(await closed, 4009);
    } finally {
      await host.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);

test(
  "runtime capability negotiation preserves constraints and rejects unavailable command bases",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pidex-runtime-capability-"));
    const host = await startHost({
      dataDir,
      port: 0,
      authorization: "device",
      adapters: adaptersFor("deterministic"),
    });
    try {
      const client = socket(host.origin);
      const offer = await nextControlMessage(client);
      assert.equal(offer.type, "host.hello");
      if (offer.type !== "host.hello") {
        throw new Error("expected Host hello");
      }

      const modelCapability = {
        id: "pi.model.select",
        version: 1,
        constraints: { values: ["deterministic"] },
      };
      assert.deepEqual(
        offer.capabilities.find(item => item.id === modelCapability.id),
        modelCapability,
      );

      client.send(JSON.stringify({
        type: "client.hello",
        expectedHostId: offer.hostId,
        protocols: [{ major: 1, minor: 2 }],
        capabilities: offer.capabilities.map(item => ({
          id: item.id,
          minVersion: item.version,
          maxVersion: item.version,
        })),
      }));
      const admitted = await nextControlMessage(client);
      assert.equal(admitted.type, "protocol.admitted");
      if (admitted.type !== "protocol.admitted") {
        throw new Error("expected protocol admission");
      }
      assert.deepEqual(
        admitted.capabilities.find(item => item.id === modelCapability.id),
        modelCapability,
      );
      assert.equal((await nextControlMessage(client)).type, "host.snapshot");

      await synchronizeEmptyControlScope(
        client,
        host.status().synchronization.cursor,
      );

      client.send(JSON.stringify({
        type: "run.submit",
        commandId: "unsupported-runtime-basis",
        sessionId: "missing-session",
        prompt: "hello",
        requiredCapability: "run.submit",
        requiredCapabilityBasis: [{ id: modelCapability.id, version: 2 }],
      }));
      const rejected = await nextControlMessage(client);
      assert.equal(rejected.type, "command.outcome");
      if (rejected.type !== "command.outcome") {
        throw new Error("expected command outcome");
      }
      assert.equal(rejected.error, "required-capability-basis-unavailable");
      client.close();
    } finally {
      await host.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
