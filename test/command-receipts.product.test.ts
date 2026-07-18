import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import {
  serverMessageSchema,
  type ServerMessage,
} from "../packages/protocol/src/status.js";

function next(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", data => {
      try {
        resolve(serverMessageSchema.parse(JSON.parse(data.toString())));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

async function connect(origin: string, token: string): Promise<WebSocket> {
  const socket = new WebSocket(
    `${origin.replace("https:", "wss:")}/control`,
    {
      rejectUnauthorized: false,
      headers: { authorization: `Bearer ${token}` },
    },
  );
  await next(socket);
  return socket;
}

test("concurrent rename rejects stale intent and replays a durable Device-scoped receipt", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-receipts-"));
  const options = {
    dataDir,
    port: 0,
    authorization: "device-a",
    adapters: adaptersFor("deterministic"),
  };
  let host = await startHost(options);
  try {
    const socket = await connect(host.origin, "device-a");
    socket.send(
      JSON.stringify({ type: "session.create", commandId: "create" }),
    );
    await next(socket);
    const created = await next(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") {
      throw new Error("expected creation");
    }
    const createdSession = created.changes[0]?.session;
    assert.ok(createdSession);
    const sessionId = createdSession.sessionId;
    const rename = {
      type: "session.rename",
      commandId: "rename-1",
      sessionId,
      name: "Alpha",
      requiredCapability: "session.rename",
      observedMetadataRevision: 1,
    };
    socket.send(JSON.stringify(rename));
    const accepted = await next(socket);
    assert.equal(accepted.type, "command.outcome");
    if (accepted.type !== "command.outcome") {
      throw new Error("expected command outcome");
    }
    assert.equal(accepted.outcome, "accepted");
    assert.ok(accepted.receipt);
    await next(socket);

    socket.send(
      JSON.stringify({ ...rename, commandId: "rename-2", name: "Beta" }),
    );
    const stale = await next(socket);
    assert.equal(stale.type, "command.outcome");
    if (stale.type !== "command.outcome") {
      throw new Error("expected command outcome");
    }
    assert.equal(stale.error, "stale-precondition");
    assert.equal(stale.currentMetadataRevision, 2);
    const receipt = accepted.receipt;
    socket.close();
    await host.close();

    host = await startHost(options);
    const retry = await connect(host.origin, "device-a");
    retry.send(JSON.stringify(rename));
    assert.deepEqual(await next(retry), accepted);
    retry.send(JSON.stringify({ ...rename, name: "Changed reuse" }));
    const conflict = await next(retry);
    assert.equal(conflict.type, "command.outcome");
    if (conflict.type !== "command.outcome") {
      throw new Error("expected command outcome");
    }
    assert.equal(conflict.error, "command-id-conflict");
    assert.ok(receipt.digest);
    retry.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
