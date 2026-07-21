import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket, { type RawData } from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import {
  clientHello,
  protocolVersion,
  serverMessageSchema,
  type ServerMessage,
} from "../packages/protocol/src/status.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

test(
  "presentation effects stay generation-scoped, capability-gated, and local to the invoking View",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pidex-presentation-"));
    const adapters = adaptersFor("deterministic");
    let releaseExecution = (): void => {};
    const executionBlocked = new Promise<void>(resolve => {
      releaseExecution = resolve;
    });
    adapters.pi.execute = async request => {
      await executionBlocked;
      request.onPresentationEffect?.({
        type: "status",
        key: "build",
        text: "running",
      });
      request.onPresentationEffect?.({
        type: "status",
        key: "build",
        text: "complete",
      });
      request.onPresentationEffect?.({
        type: "status",
        key: "build",
        text: null,
      });
      request.onPresentationEffect?.({
        type: "title",
        text: "<img src=x onerror=alert(1)>",
      });
      request.onPresentationEffect?.({
        type: "widget",
        key: "details",
        text: "safe widget text",
      });
      request.onPresentationEffect?.({
        type: "notification",
        level: "warning",
        text: "check the build",
      });
      request.onPresentationEffect?.({
        type: "editor-text",
        text: "preserve this draft",
      });
      throw new Error("worker-lost");
    };

    const host = await startHost({
      dataDir,
      port: 0,
      authorization: "device",
      adapters,
    });
    const invokingClient = connect(host.origin);
    const observingClient = connect(host.origin);
    const unsupportedClient = connect(host.origin);

    try {
      await Promise.all([
        negotiateControl(invokingClient),
        negotiateControl(observingClient),
        negotiateWithoutPresentationEffects(unsupportedClient),
      ]);

      invokingClient.send(JSON.stringify({
        type: "session.create",
        commandId: "create-presentation-session",
      }));
      await nextControlMessage(invokingClient);
      const changeSet = await nextControlMessage(invokingClient);
      assert.equal(changeSet.type, "host.change-set");
      if (changeSet.type !== "host.change-set") {
        throw new Error("expected Session creation");
      }
      const sessionId = changeSet.changes[0]?.session?.sessionId;
      assert.ok(sessionId);

      await Promise.all([
        observeSession(invokingClient, sessionId),
        observeSession(observingClient, sessionId),
        observeSession(unsupportedClient, sessionId),
      ]);

      const invokingMessages = collectUntilRunCompleted(invokingClient);
      const observingMessages = collectUntilRunCompleted(observingClient);
      const unsupportedMessages = collectUntilRunCompleted(unsupportedClient);

      invokingClient.send(JSON.stringify({
        type: "run.submit",
        commandId: "run-presentation-effects",
        sessionId,
        prompt: "show effects",
        requiredCapability: "run.submit",
        invokingView: { viewId: "session-view", draftRevision: 1 },
      }));
      const outcome = await nextControlMessage(invokingClient);
      assert.equal(outcome.type, "command.outcome");

      invokingClient.send(JSON.stringify({
        type: "view.observe",
        sessionId,
        viewId: "session-view",
        draftRevision: 2,
      }));
      const observationBarrier = waitForCommandOutcome(
        invokingClient,
        "observation-barrier",
      );
      invokingClient.send(JSON.stringify({
        type: "run.submit",
        commandId: "observation-barrier",
        sessionId,
        prompt: "do not dispatch",
        requiredCapability: "run.submit",
        requiredCapabilityBasis: [{ id: "run.submit", version: 2 }],
      }));
      await observationBarrier;
      releaseExecution();

      const [invoking, observing, unsupported] = await Promise.all([
        invokingMessages,
        observingMessages,
        unsupportedMessages,
      ]);
      const invokingEffects = presentationEffects(invoking);
      const observingEffects = presentationEffects(observing);
      const unsupportedEffects = presentationEffects(unsupported);

      assert.deepEqual(
        invokingEffects.filter(message => message.effect.type !== "editor-text"),
        observingEffects,
      );
      assert.deepEqual(
        observingEffects.map(message => message.effect),
        [
          { type: "status", key: "build", text: "running" },
          { type: "status", key: "build", text: "complete" },
          { type: "status", key: "build", text: null },
          { type: "title", text: "<img src=x onerror=alert(1)>" },
          { type: "widget", key: "details", text: "safe widget text" },
          {
            type: "notification",
            level: "warning",
            text: "check the build",
          },
        ],
      );
      assert.deepEqual(
        invokingEffects.find(message => message.effect.type === "editor-text")
          ?.effect,
        {
          type: "editor-text",
          text: "preserve this draft",
          disposition: "suggest",
          viewId: "session-view",
          draftRevision: 1,
        },
      );
      assert.deepEqual(unsupportedEffects, []);

      const reset = invoking.find(message => message.type === "presentation.reset");
      assert.ok(reset);
      assert.equal(
        reset.type === "presentation.reset" && reset.workerGeneration,
        invokingEffects[0]?.workerGeneration,
      );
      assert.equal(
        observing.some(message => message.type === "presentation.reset"),
        true,
      );
      assert.equal(
        unsupported.some(message => message.type === "presentation.reset"),
        false,
      );
    } finally {
      invokingClient.close();
      observingClient.close();
      unsupportedClient.close();
      await host.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);

function connect(origin: string): WebSocket {
  return new WebSocket(`${origin.replace("https:", "wss:")}/control`, {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer device" },
  });
}

async function negotiateWithoutPresentationEffects(
  socket: WebSocket,
): Promise<void> {
  const offer = await nextControlMessage(socket);
  if (offer.type !== "host.hello") {
    throw new Error("expected Host hello");
  }

  const hello = clientHello(offer.hostId);
  hello.capabilities = hello.capabilities.filter(
    capability => capability.id !== "presentation.effects",
  );
  socket.send(JSON.stringify(hello));
  assert.equal((await nextControlMessage(socket)).type, "protocol.admitted");
  assert.equal((await nextControlMessage(socket)).type, "host.snapshot");
}

async function observeSession(
  socket: WebSocket,
  sessionId: string,
): Promise<void> {
  socket.send(JSON.stringify({
    type: "scope.set",
    sessionIds: [sessionId],
    protocolVersion,
  }));

  while (true) {
    const message = await nextControlMessage(socket);
    if (
      message.type === "scope.reset" &&
      message.barrier.scope.kind === "session" &&
      message.barrier.scope.sessionId === sessionId
    ) {
      return;
    }
  }
}

function collectUntilRunCompleted(
  socket: WebSocket,
): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const onMessage = (data: RawData): void => {
      try {
        const message = serverMessageSchema.parse(JSON.parse(data.toString()));
        messages.push(message);
        if (message.type === "run.completed") {
          socket.off("message", onMessage);
          socket.off("error", onError);
          resolve(messages);
        }
      } catch (error) {
        socket.off("message", onMessage);
        socket.off("error", onError);
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      socket.off("message", onMessage);
      reject(error);
    };

    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function waitForCommandOutcome(
  socket: WebSocket,
  commandId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData): void => {
      try {
        const message = serverMessageSchema.parse(JSON.parse(data.toString()));
        if (
          message.type === "command.outcome" &&
          message.commandId === commandId
        ) {
          socket.off("message", onMessage);
          socket.off("error", onError);
          resolve();
        }
      } catch (error) {
        socket.off("message", onMessage);
        socket.off("error", onError);
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      socket.off("message", onMessage);
      reject(error);
    };

    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function presentationEffects(
  messages: ServerMessage[],
): Array<Extract<ServerMessage, { type: "presentation.effect" }>> {
  return messages.filter(
    (message): message is Extract<
      ServerMessage,
      { type: "presentation.effect" }
    > => message.type === "presentation.effect",
  );
}
