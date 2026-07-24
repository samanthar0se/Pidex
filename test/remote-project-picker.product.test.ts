import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import type { ServerMessage } from "../packages/protocol/src/status.js";
import {
  controlWebSocketUrl,
  negotiateControl,
  nextControlMessage,
} from "./control-client.js";

test("a synchronized Client browses Host directories and atomically adds a Project with its Workspace", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "000-pidex-project-picker-"));
  const selectedDirectory = join(dataDir, "chosen-project");
  await mkdir(selectedDirectory);
  const options = {
    dataDir: join(dataDir, "authority"),
    port: 0,
    authorization: "test-device",
    adapters: adaptersFor("deterministic"),
  };
  let host = await startHost(options);
  try {
    const socket = new WebSocket(controlWebSocketUrl(host.origin), {
      headers: { authorization: "Bearer test-device" },
    });
    await negotiateControl(socket);

    socket.send(JSON.stringify({
      type: "project.add-from-directory",
      commandId: "forged-selection",
      selectionToken: "not-issued-by-host",
      projectName: "Forged",
    }));
    assert.deepEqual(await nextControlMessage(socket), {
      type: "command.outcome",
      commandId: "forged-selection",
      outcome: "rejected",
      error: "directory-selection-expired",
    });

    const selectionToken = await browseTo(socket, selectedDirectory);
    socket.send(JSON.stringify({
      type: "project.add-from-directory",
      commandId: "add-project",
      selectionToken,
      projectName: "Picker Project",
    }));
    assert.deepEqual(await nextControlMessage(socket), {
      type: "command.outcome",
      commandId: "add-project",
      outcome: "accepted",
    });
    const changed = await nextControlMessage(socket);
    assert.equal(changed.type, "host.change-set");
    if (changed.type !== "host.change-set") assert.fail("expected Project change");
    const projectChange = changed.changes.find(change => change.type === "project.created");
    assert.ok(projectChange && projectChange.type === "project.created");
    assert.equal(projectChange.project.name, "Picker Project");
    assert.equal(projectChange.workspace.directory, selectedDirectory);

    socket.close();
    await host.close();
    host = await startHost(options);
    const restarted = new WebSocket(controlWebSocketUrl(host.origin), {
      headers: { authorization: "Bearer test-device" },
    });
    const snapshot = await negotiateControl(restarted);
    assert.equal(snapshot.projects[0]?.name, "Picker Project");
    assert.equal(snapshot.workspaces[0]?.directory, selectedDirectory);
    restarted.close();
  } finally {
    await host.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function browseTo(socket: WebSocket, target: string): Promise<string> {
  let response = await browse(socket);
  const rootPath = parse(target).root;
  let current = response.entries.find(entry => entry.displayPath === rootPath);
  assert.ok(current, `root ${rootPath} was not advertised`);
  const segments: string[] = [];
  for (let path = target; path !== rootPath; path = dirname(path)) {
    segments.unshift(basename(path));
  }
  let accumulated = rootPath;
  for (const segment of segments) {
    accumulated = join(accumulated, segment);
    response = await browse(socket, current.token);
    current = response.entries.find(entry => entry.displayPath === accumulated);
    assert.ok(current, `${accumulated} was not returned`);
  }
  return current.token;
}

async function browse(socket: WebSocket, parentToken?: string) {
  const requestId = `browse-${Math.random()}`;
  socket.send(JSON.stringify({ type: "directory.browse", requestId, parentToken }));
  const message: ServerMessage = await nextControlMessage(socket);
  assert.equal(message.type, "directory.browse-result");
  if (message.type !== "directory.browse-result") assert.fail("expected directory result");
  assert.equal(message.error, undefined);
  return message;
}
