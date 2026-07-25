import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import {
  controlWebSocketUrl,
  negotiateControl,
  nextAttentionChange,
  nextControlMessage,
} from "./control-client.js";

test("the Session attention summary derives working and quiet from exact Run facts", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-attention-"));
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters: adaptersFor("deterministic"),
  });
  try {
    const socket = connect(host.origin);
    await negotiateControl(socket);

    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    if (created.type !== "host.change-set") throw new Error("expected Session creation");
    const sessionId = created.changes[0]?.session?.sessionId;
    assert.ok(sessionId);

    // A Session with no Run facts is quiet, and quiet carries plain recency.
    const initial = created.changes[0]?.session;
    assert.equal(initial?.attention, "quiet");
    assert.equal(typeof initial?.activity?.at, "number");
    assert.equal(initial?.activity?.detail, undefined);

    socket.send(JSON.stringify({
      type: "run.submit",
      commandId: "run-1",
      sessionId,
      prompt: "hello",
      requiredCapability: "run.submit",
    }));

    // Accepted work that progresses without user action reads as working, and
    // settles back to quiet once the Run reaches a terminal state.
    const observed: string[] = [];
    for (let index = 0; index < 12 && observed.at(-1) !== "quiet"; index++) {
      const change = await nextAttentionChange(socket);
      assert.equal(change.sessionId, sessionId);
      if (change.attention !== observed.at(-1)) observed.push(change.attention);
    }
    assert.deepEqual(observed, ["working", "quiet"]);

    // The settled summary is durable across a fresh projection, not just a
    // transient broadcast.
    const reconnected = connect(host.origin);
    const snapshot = await negotiateControl(reconnected);
    const session = snapshot.sessions.find(item => item.sessionId === sessionId);
    assert.equal(session?.attention, "quiet");
    reconnected.close();
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

function connect(origin: string): WebSocket {
  return new WebSocket(controlWebSocketUrl(origin), {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer device" },
  });
}
