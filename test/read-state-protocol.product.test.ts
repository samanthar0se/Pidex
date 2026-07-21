import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import {
  clientHello,
  hostChangeSchema,
  protocolVersion,
  sessionReadStateSchema,
} from "../packages/protocol/src/status.js";
import { nextControlMessage } from "./control-client.js";

function socket(origin: string): WebSocket {
  return new WebSocket(`${origin.replace("https:", "wss:")}/control`, {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer device" },
  });
}

test("protocol 1.2 requires exact session.read-state v1 before a snapshot", async () => {
  assert.equal(protocolVersion, "1.2");
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-read-state-protocol-"));
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters: adaptersFor("deterministic"),
  });
  try {
    for (const capabilityVersion of [undefined, 2]) {
      const client = socket(host.origin);
      const offer = await nextControlMessage(client);
      assert.equal(offer.type, "host.hello");
      if (offer.type !== "host.hello") assert.fail("expected Host hello");
      assert.deepEqual(
        offer.capabilities.find(item => item.id === "session.read-state"),
        { id: "session.read-state", version: 1 },
      );

      const hello = clientHello(offer.hostId);
      hello.capabilities = hello.capabilities.filter(
        item => item.id !== "session.read-state",
      );
      if (capabilityVersion !== undefined) {
        hello.capabilities.push({
          id: "session.read-state",
          minVersion: capabilityVersion,
          maxVersion: capabilityVersion,
        });
      }
      client.send(JSON.stringify(hello));
      const rejected = await nextControlMessage(client);
      assert.equal(rejected.type, "protocol.update-required");
      assert.equal(
        rejected.type === "protocol.update-required" && rejected.reason,
        "missing-capability",
      );
      client.close();
    }

    const oldClient = socket(host.origin);
    const oldOffer = await nextControlMessage(oldClient);
    if (oldOffer.type !== "host.hello") assert.fail("expected Host hello");
    const oldHello = clientHello(oldOffer.hostId);
    oldHello.protocols = [{ major: 1, minor: 1 }];
    oldClient.send(JSON.stringify(oldHello));
    const oldRejected = await nextControlMessage(oldClient);
    assert.equal(oldRejected.type, "protocol.update-required");
    oldClient.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("read state is atomic and malformed live shapes fail closed", () => {
  const valid = {
    readThroughTimelineRevision: 0,
    readStatus: "read",
    readStateRevision: 1,
  };
  assert.deepEqual(sessionReadStateSchema.parse(valid), valid);
  for (const malformed of [
    { ...valid, readStateRevision: 0 },
    { ...valid, readStatus: "unknown" },
    { ...valid, readThroughTimelineRevision: -1 },
    { readStatus: "read", readStateRevision: 1 },
  ]) {
    assert.equal(sessionReadStateSchema.safeParse(malformed).success, false);
  }
  assert.equal(hostChangeSchema.safeParse({
    type: "session.read-state-changed",
    sessionId: "session_1",
    readState: { ...valid, readStatus: "unknown" },
  }).success, false);
  assert.equal(hostChangeSchema.safeParse({
    type: "session.read-state-changed",
    sessionId: "session_1",
    readState: valid,
  }).success, true);
});

test("mark-read rejects a non-exact capability basis before a receipt", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-mark-read-basis-"));
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
    client.send(JSON.stringify(clientHello(offer.hostId)));
    assert.equal((await nextControlMessage(client)).type, "protocol.admitted");
    assert.equal((await nextControlMessage(client)).type, "host.snapshot");

    client.send(JSON.stringify({
      type: "session.mark-read",
      commandId: "mark-1",
      sessionId: "session_missing",
      presentedTimelineRevision: 0,
      requiredCapabilityBasis: [{ id: "session.read-state", version: 2 }],
    }));
    const outcome = await nextControlMessage(client);
    assert.equal(outcome.type, "command.outcome");
    if (outcome.type !== "command.outcome") assert.fail("expected outcome");
    assert.equal(outcome.outcome, "rejected");
    assert.equal(outcome.error, "required-capability-basis-unavailable");
    assert.equal(outcome.receipt, undefined);
    client.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
