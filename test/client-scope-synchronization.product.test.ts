import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket, { type RawData } from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import {
  protocolVersion,
  serverMessageSchema,
  type ServerMessage,
} from "../packages/protocol/src/status.js";

function nextServerMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (bytes: RawData): void => {
      socket.off("error", onError);
      try {
        resolve(serverMessageSchema.parse(JSON.parse(bytes.toString())));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      socket.off("message", onMessage);
      reject(error);
    };

    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

async function connect(
  origin: string,
): Promise<{ socket: WebSocket; cursor: string }> {
  const socket = new WebSocket(`${origin.replace("https:", "wss:")}/control`, {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer device" },
  });
  const snapshot = await nextServerMessage(socket);
  if (snapshot.type !== "host.snapshot") {
    assert.fail("Expected a Host snapshot after connecting");
  }

  return { socket, cursor: snapshot.status.synchronization.cursor };
}

function setScope(
  socket: WebSocket,
  scope: {
    sessionIds: string[];
    cursor?: string;
    resourceRevisions?: Record<string, number>;
  },
): void {
  socket.send(JSON.stringify({ type: "scope.set", protocolVersion, ...scope }));
}

test("client scopes resume retained changes and reset atomically across broken continuity", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-sync-"));
  const otherDir = await mkdtemp(join(tmpdir(), "pidex-sync-other-"));
  const options = {
    dataDir,
    port: 0,
    authorization: "device",
    adapters: adaptersFor("deterministic"),
  };
  let host = await startHost(options);
  const other = await startHost({ ...options, dataDir: otherDir });
  try {
    const first = await connect(host.origin);
    const originalCursor = first.cursor;
    first.socket.send(
      JSON.stringify({ type: "session.create", commandId: "create" }),
    );
    await nextServerMessage(first.socket);
    const created = await nextServerMessage(first.socket);
    if (created.type !== "host.change-set") {
      assert.fail("Expected session creation to publish a change set");
    }

    const session = created.changes[0]?.session;
    assert.ok(session);
    // Simulate disconnecting before the delivered cursor is persisted.
    first.socket.close();

    await host.close();
    host = await startHost(options);
    const resumed = await connect(host.origin);
    setScope(resumed.socket, { sessionIds: [], cursor: originalCursor });
    const redelivered = await nextServerMessage(resumed.socket);
    if (redelivered.type !== "host.change-set") {
      assert.fail("Expected the missed change set to be redelivered");
    }
    assert.equal(
      (await nextServerMessage(resumed.socket)).type,
      "scope.current",
    );

    setScope(resumed.socket, {
      sessionIds: [session.sessionId],
      cursor: redelivered.cursor,
    });
    assert.equal(
      (await nextServerMessage(resumed.socket)).type,
      "scope.current",
    );
    const added = await nextServerMessage(resumed.socket);
    if (added.type !== "scope.reset") {
      assert.fail("Expected the new Session scope to reset");
    }
    assert.equal(added.barrier.scope.kind, "session");

    setScope(resumed.socket, {
      sessionIds: [],
      cursor: redelivered.cursor,
      resourceRevisions: { [session.sessionId]: 99 },
    });
    const revisionReset = await nextServerMessage(resumed.socket);
    if (revisionReset.type !== "scope.reset") {
      assert.fail("Expected mismatched revisions to reset the Host scope");
    }
    assert.equal(revisionReset.reason, "revision-mismatch");

    host.rotateSynchronizationEpoch();
    setScope(resumed.socket, { sessionIds: [], cursor: originalCursor });
    const epochReset = await nextServerMessage(resumed.socket);
    if (epochReset.type !== "scope.reset") {
      assert.fail("Expected an epoch change to reset the Host scope");
    }
    assert.equal(epochReset.reason, "epoch-mismatch");

    const another = await connect(other.origin);
    setScope(another.socket, { sessionIds: [], cursor: originalCursor });
    const hostReset = await nextServerMessage(another.socket);
    if (hostReset.type !== "scope.reset") {
      assert.fail("Expected a cursor from another Host to reset the Host scope");
    }
    assert.equal(hostReset.reason, "host-mismatch");
    resumed.socket.close();
    another.socket.close();
  } finally {
    await host.close();
    await other.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});
