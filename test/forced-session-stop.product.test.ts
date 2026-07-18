import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import {
  adaptersFor,
  type HostAdapters,
} from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import {
  serverMessageSchema,
  type ServerMessage,
} from "../packages/protocol/src/status.js";
import { negotiateControl } from "./control-client.js";

type RunExecutionMessage = Extract<
  ServerMessage,
  { type: "run.execution" }
>;
type RunCompletedMessage = Extract<
  ServerMessage,
  { type: "run.completed" }
>;

test("force-stop closes only the uncooperative Session Job and settles the run as cancelled", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-force-stop-"));
  const base = adaptersFor("deterministic");
  const containedSessionIds: string[] = [];
  const terminatedSessionIds: string[] = [];
  const closedSessionIds: string[] = [];
  const adapters: HostAdapters = {
    ...base,
    pi: {
      ...base.pi,
      execute: request =>
        request.prompt === "hang"
          ? new Promise(() => {})
          : Promise.resolve({
              text: "sibling survived",
              checkpoint: `cp:${request.sessionId}`,
            }),
      flushCheckpoint: async (_sessionId, checkpoint) => checkpoint,
    },
    windows: {
      ...base.windows,
      createContainedSessionWorker: sessionId => {
        containedSessionIds.push(sessionId);
        return {
          sessionId,
          terminate: () => {
            terminatedSessionIds.push(sessionId);
          },
          close: () => {
            closedSessionIds.push(sessionId);
          },
        };
      },
    },
  };
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters,
    cooperativeStopTimeoutMs: 5,
    forcedReconciliationTimeoutMs: 5,
  });
  const socket = connectToHost(host.origin);

  try {
    await negotiateControl(socket);
    const messages = collectMessages(socket);
    const sessionId = await createSession(socket, messages, "create-hanging");
    const siblingSessionId = await createSession(
      socket,
      messages,
      "create-sibling",
    );
    await setScope(socket, messages, [sessionId, siblingSessionId]);

    const execution = await submitRun(
      socket,
      messages,
      sessionId,
      "hang",
      "run-hanging",
    );
    const stopMessageIndex = messages.length;
    socket.send(JSON.stringify({
      type: "run.stop",
      commandId: "stop",
      sessionId,
      runId: execution.runId,
      workerGeneration: execution.workerGeneration,
      observedState: "executing",
      observedTimelineRevision: execution.timelineRevision,
      requiredCapability: "run.stop",
    }));

    const completed = await waitForRunCompletion(
      messages,
      execution.runId,
      stopMessageIndex,
    );
    assert.equal(completed.run.state, "cancelled");
    assert.match(completed.timeline.at(-1)!.text, /side effects may remain/);
    assert.deepEqual(terminatedSessionIds, [sessionId]);
    assert.deepEqual(closedSessionIds, [sessionId]);

    const siblingMessageIndex = messages.length;
    const siblingExecution = await submitRun(
      socket,
      messages,
      siblingSessionId,
      "continue",
      "run-sibling",
    );
    const siblingCompleted = await waitForRunCompletion(
      messages,
      siblingExecution.runId,
      siblingMessageIndex,
    );
    assert.equal(siblingCompleted.run.state, "completed");
    assert.deepEqual(containedSessionIds, [sessionId, siblingSessionId]);
    assert.deepEqual(terminatedSessionIds, [sessionId]);
  } finally {
    socket.close();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("containment failure settles the run as failed without invoking Pi", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-containment-failure-"));
  const base = adaptersFor("deterministic");
  let executed = false;
  const adapters: HostAdapters = {
    ...base,
    pi: {
      ...base.pi,
      execute: async request => {
        executed = true;
        return { text: "escaped", checkpoint: request.sessionId };
      },
    },
    windows: {
      ...base.windows,
      createContainedSessionWorker: () => {
        throw new Error("assign-job-denied");
      },
    },
  };
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters,
  });
  const socket = connectToHost(host.origin);

  try {
    await negotiateControl(socket);
    const messages = collectMessages(socket);
    const sessionId = await createSession(socket, messages, "create");
    await setScope(socket, messages, [sessionId]);

    const submitMessageIndex = messages.length;
    socket.send(JSON.stringify({
      type: "run.submit",
      commandId: "run",
      sessionId,
      prompt: "escape",
      requiredCapability: "run.submit",
    }));
    const completed = await waitForMessage(
      messages,
      submitMessageIndex,
      message => message.type === "run.completed",
    );

    assert.equal(completed.run.state, "failed");
    assert.match(
      completed.timeline.at(-1)!.text,
      /session-containment-setup-failed: assign-job-denied/,
    );
    assert.equal(executed, false);
  } finally {
    socket.close();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

function connectToHost(origin: string): WebSocket {
  return new WebSocket(`${origin.replace("https:", "wss:")}/control`, {
    rejectUnauthorized: false,
    headers: { authorization: "Bearer device" },
  });
}

function collectMessages(socket: WebSocket): ServerMessage[] {
  const messages: ServerMessage[] = [];
  socket.on("message", data => {
    messages.push(serverMessageSchema.parse(JSON.parse(data.toString())));
  });
  return messages;
}

async function createSession(
  socket: WebSocket,
  messages: ServerMessage[],
  commandId: string,
): Promise<string> {
  const messageIndex = messages.length;
  socket.send(JSON.stringify({ type: "session.create", commandId }));
  const created = await waitForMessage(
    messages,
    messageIndex,
    message => message.type === "host.change-set",
  );
  const sessionChange = created.changes.find(
    change => change.type === "session.created",
  );
  assert.ok(sessionChange);
  return sessionChange.session.sessionId;
}

async function setScope(
  socket: WebSocket,
  messages: ServerMessage[],
  sessionIds: string[],
): Promise<void> {
  const messageIndex = messages.length;
  socket.send(JSON.stringify({
    type: "scope.set",
    sessionIds,
    protocolVersion: "1.0",
  }));
  await waitForMessage(
    messages,
    messageIndex,
    message => message.type === "scope.reset",
  );
}

async function submitRun(
  socket: WebSocket,
  messages: ServerMessage[],
  sessionId: string,
  prompt: string,
  commandId: string,
): Promise<RunExecutionMessage> {
  const messageIndex = messages.length;
  socket.send(JSON.stringify({
    type: "run.submit",
    commandId,
    sessionId,
    prompt,
    requiredCapability: "run.submit",
  }));
  return waitForMessage(
    messages,
    messageIndex,
    (message): message is RunExecutionMessage =>
      message.type === "run.execution" &&
      message.sessionId === sessionId &&
      message.state === "executing",
  );
}

function waitForRunCompletion(
  messages: ServerMessage[],
  runId: string,
  messageIndex: number,
): Promise<RunCompletedMessage> {
  return waitForMessage(
    messages,
    messageIndex,
    (message): message is RunCompletedMessage =>
      message.type === "run.completed" && message.run.runId === runId,
  );
}

async function waitForMessage<T extends ServerMessage>(
  messages: ServerMessage[],
  messageIndex: number,
  predicate: (message: ServerMessage) => message is T,
): Promise<T> {
  const deadline = Date.now() + 2_000;
  while (true) {
    const message = messages.slice(messageIndex).find(predicate);
    if (message) {
      return message;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for Host message");
    }
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
