import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

test("an accepted prompt completes durably and its receipt survives a Host restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-run-"));
  const options = {
    dataDir,
    port: 0,
    authorization: "device",
    adapters: adaptersFor("deterministic"),
  };
  let host = await startHost(options);
  try {
    const socket = connect(host.origin);
    await negotiateControl(socket);
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const change = await nextControlMessage(socket);
    assert.equal(change.type, "host.change-set");
    if (change.type !== "host.change-set") {
      throw new Error("expected Session creation");
    }

    const sessionId = change.changes[0]?.session?.sessionId;
    assert.ok(sessionId);
    const submit = {
      type: "run.submit",
      commandId: "run-1",
      sessionId,
      prompt: "hello",
      requiredCapability: "run.submit",
    };
    socket.send(JSON.stringify(submit));
    const accepted = await nextControlMessage(socket);
    assert.equal(
      accepted.type === "command.outcome" && accepted.outcome,
      "accepted",
    );
    const completed = await nextControlMessage(socket);
    assert.equal(completed.type, "run.completed");
    if (completed.type === "run.completed") {
      assert.equal(completed.run.state, "completed");
      assert.deepEqual(
        completed.timeline.map(entry => entry.kind),
        ["prompt", "response"],
      );
    }
    socket.close();
    await host.close();

    host = await startHost(options);
    const reconnected = connect(host.origin);
    await negotiateControl(reconnected);
    reconnected.send(JSON.stringify(submit));
    assert.deepEqual(await nextControlMessage(reconnected), accepted);
    reconnected.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

function connect(origin: string): WebSocket {
  return new WebSocket(`${origin.replace("https:", "wss:")}/control`, {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer device" },
  });
}
