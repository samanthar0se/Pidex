import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import {
  serverMessageSchema,
  type HostSnapshot,
  type ServerMessage,
} from "../packages/protocol/src/status.js";
import { negotiateControl } from "./control-client.js";

async function connect(
  origin: string,
): Promise<{ socket: WebSocket; snapshot: HostSnapshot }> {
  const socket = new WebSocket(`${origin.replace("https:", "wss:")}/control`, {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer test-device" },
  });
  const snapshot = await negotiateControl(socket);
  return { socket, snapshot };
}

function next(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", bytes => {
      try {
        resolve(parseMessage(bytes));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function parseMessage(bytes: WebSocket.RawData): ServerMessage {
  return serverMessageSchema.parse(JSON.parse(bytes.toString()));
}

test("scoped empty Sessions reject atomically, publish typed changes, and survive restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-sessions-"));
  const options = {
    dataDir,
    port: 0,
    authorization: "test-device",
    adapters: adaptersFor("deterministic"),
    initialCatalog: {
      projects: [
        { projectId: "project_alpha", name: "Alpha" },
        { projectId: "project_beta", name: "Beta" },
      ],
      workspaces: [
        {
          workspaceId: "workspace_main",
          projectId: "project_alpha",
          name: "Main",
        },
      ],
    },
  };
  let host = await startHost(options);
  try {
    const first = await connect(host.origin);
    assert.deepEqual(first.snapshot.sessions, []);
    first.socket.send(
      JSON.stringify({
        type: "session.create",
        commandId: "bad",
        projectId: "project_beta",
        workspaceId: "workspace_main",
      }),
    );
    assert.deepEqual(await next(first.socket), {
      type: "command.outcome",
      commandId: "bad",
      outcome: "rejected",
      error: "workspace-project-mismatch",
    });

    first.socket.send(
      JSON.stringify({
        type: "session.create",
        commandId: "good",
        projectId: "project_alpha",
        workspaceId: "workspace_main",
      }),
    );
    assert.deepEqual(await next(first.socket), {
      type: "command.outcome",
      commandId: "good",
      outcome: "accepted",
    });
    const change = await next(first.socket);
    assert.equal(change.type, "host.change-set");
    if (change.type !== "host.change-set") {
      throw new Error("expected change set");
    }
    const createdSession = change.changes[0]?.session;
    assert.ok(createdSession);
    assert.deepEqual(createdSession, {
      sessionId: createdSession.sessionId,
      name: "Untitled Session",
      projectId: "project_alpha",
      workspaceId: "workspace_main",
      retention: "available",
      residency: "sleeping",
      metadataRevision: 1,
      timelineRevision: 1,
    });
    first.socket.close();
    await host.close();

    host = await startHost(options);
    const restarted = await connect(host.origin);
    assert.equal(restarted.snapshot.sessions.length, 1);
    assert.equal(restarted.snapshot.sessions[0]?.residency, "sleeping");
    restarted.socket.close();
    assert.deepEqual(
      (await readdir(dataDir)).sort(),
      [
        "active-generation.json",
        "generations",
        "objects",
        "tls",
      ].sort(),
    );
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
