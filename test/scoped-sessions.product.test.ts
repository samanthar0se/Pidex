import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { serverMessageSchema, type ServerMessage } from "../packages/protocol/src/status.js";

function connect(origin: string): Promise<{ socket: WebSocket; snapshot: Extract<ServerMessage, { type: "host.snapshot" }> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace("https:", "wss:")}/control`, {
      rejectUnauthorized: false,
      headers: { authorization: "Bearer test-device" },
    });
    socket.once("message", bytes => {
      const message = serverMessageSchema.parse(JSON.parse(bytes.toString()));
      if (message.type !== "host.snapshot") return reject(new Error("expected snapshot"));
      resolve({ socket, snapshot: message });
    });
    socket.once("error", reject);
  });
}

function next(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", bytes => resolve(serverMessageSchema.parse(JSON.parse(bytes.toString()))));
    socket.once("error", reject);
  });
}

test("scoped empty Sessions reject atomically, publish typed changes, and survive restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-sessions-"));
  const options = {
    dataDir, port: 0, authorization: "test-device", adapters: adaptersFor("deterministic"),
    initialCatalog: {
      projects: [{ projectId: "project_alpha", name: "Alpha" }, { projectId: "project_beta", name: "Beta" }],
      workspaces: [{ workspaceId: "workspace_main", projectId: "project_alpha", name: "Main" }],
    },
  };
  let host = await startHost(options);
  try {
    const first = await connect(host.origin);
    assert.deepEqual(first.snapshot.sessions, []);
    first.socket.send(JSON.stringify({ type: "session.create", commandId: "bad", projectId: "project_beta", workspaceId: "workspace_main" }));
    assert.deepEqual(await next(first.socket), { type: "command.outcome", commandId: "bad", outcome: "rejected", error: "workspace-project-mismatch" });

    first.socket.send(JSON.stringify({ type: "session.create", commandId: "good", projectId: "project_alpha", workspaceId: "workspace_main" }));
    assert.deepEqual(await next(first.socket), { type: "command.outcome", commandId: "good", outcome: "accepted" });
    const change = await next(first.socket);
    assert.equal(change.type, "host.change-set");
    if (change.type !== "host.change-set") throw new Error("expected change set");
    assert.deepEqual(change.changes[0]?.session, {
      sessionId: change.changes[0]?.session.sessionId, projectId: "project_alpha", workspaceId: "workspace_main",
      retention: "available", residency: "sleeping", metadataRevision: 1, timelineRevision: 1,
    });
    first.socket.close();
    await host.close();

    host = await startHost(options);
    const restarted = await connect(host.origin);
    assert.equal(restarted.snapshot.sessions.length, 1);
    assert.equal(restarted.snapshot.sessions[0]?.residency, "sleeping");
    restarted.socket.close();
    assert.deepEqual((await readdir(dataDir)).sort(), ["authority.sqlite", "authority.sqlite-shm", "authority.sqlite-wal", "tls"].sort());
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
