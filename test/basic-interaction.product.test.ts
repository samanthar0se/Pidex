import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor, type PiInteractionRequest } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { protocolVersion, type Interaction } from "../packages/protocol/src/status.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

test("all basic Interaction kinds validate and settle only through their exact worker", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-interaction-"));
  const adapters = adaptersFor("deterministic");
  const requests: PiInteractionRequest[] = [
    { correlationId: "select-1", kind: "select", message: "<b>Choose</b>", options: ["a", "b"] },
    { correlationId: "confirm-1", kind: "confirm", message: "Continue?" },
    { correlationId: "input-1", kind: "input", message: "Name" },
    { correlationId: "editor-1", kind: "editor", message: "Body" },
  ];
  const applied: unknown[] = [];
  adapters.pi.execute = async request => {
    for (const interaction of requests) applied.push(await request.onInteraction!(interaction));
    return { text: "done", checkpoint: "cp" };
  };
  const host = await startHost({ dataDir, port: 0, authorization: "device", adapters });
  try {
    const socket = new WebSocket(`${host.origin.replace("https:", "wss:")}/control`, { rejectUnauthorized: false, headers: { authorization: "Bearer device" } });
    await negotiateControl(socket);
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") throw new Error("missing session");
    const sessionId = created.changes[0]!.session.sessionId;
    socket.send(JSON.stringify({ type: "scope.set", sessionIds: [sessionId], protocolVersion }));
    for (;;) {
      const scoped = await nextControlMessage(socket);
      if (scoped.type === "scope.reset" && scoped.barrier.scope.kind === "session") break;
    }
    socket.send(JSON.stringify({ type: "run.submit", commandId: "run", sessionId, prompt: "go", requiredCapability: "run.submit" }));
    await nextControlMessage(socket);

    const answers: unknown[] = ["b", true, "Ada", "text"];
    for (let index = 0; index < requests.length; index++) {
      const interaction = await nextOpenInteraction(socket);
      assert.equal(interaction.payload.message, requests[index]!.message);
      if (index === 0) {
        sendResolution(socket, interaction, "not-offered", false, "invalid");
        const rejected = await nextControlMessage(socket);
        assert.equal(rejected.type === "command.outcome" && rejected.outcome, "rejected");
      }
      sendResolution(socket, interaction, answers[index], index === 1, `answer-${index}`);
      assert.equal((await nextControlMessage(socket)).type, "interaction.change");
      assert.equal((await nextControlMessage(socket)).type, "command.outcome");
      const terminal = await nextControlMessage(socket);
      assert.equal(terminal.type, "interaction.change");
      if (terminal.type === "interaction.change") assert.equal(terminal.interaction.state, index === 1 ? "dismissed" : "responded");
    }
    while ((await nextControlMessage(socket)).type !== "run.completed") { /* settlement */ }
    assert.deepEqual(applied, [
      { dismissed: false, value: "b" }, { dismissed: true },
      { dismissed: false, value: "Ada" }, { dismissed: false, value: "text" },
    ]);
    socket.close();
  } finally { await host.close(); await rm(dataDir, { recursive: true, force: true }); }
});

async function nextOpenInteraction(socket: WebSocket): Promise<Interaction> {
  for (;;) {
    const message = await nextControlMessage(socket);
    if (message.type === "interaction.change" && message.interaction.state === "open") return message.interaction;
  }
}

function sendResolution(socket: WebSocket, interaction: Interaction, value: unknown, dismiss: boolean, commandId: string): void {
  socket.send(JSON.stringify({ type: "interaction.resolve", commandId, interactionId: interaction.interactionId,
    workerGeneration: interaction.workerGeneration, observedRevision: interaction.revision, dismiss, value }));
}
