import WebSocket, { type RawData } from "ws";
import {
  clientHello,
  protocolVersion,
  serverMessageSchema,
  type HostSnapshot,
  type ServerMessage,
} from "../packages/protocol/src/status.js";

export function controlWebSocketUrl(origin: string): string {
  return `${origin.replace(/^http/, "ws")}/control`;
}

/**
 * The Session attention summary is an ancillary discovery cue the Host may
 * broadcast at any point, so ordinary sequencing assertions skip it the way a
 * real Client does. Use {@link nextAttentionChange} to observe it directly.
 */
function isAttentionOnly(message: ServerMessage): boolean {
  return message.type === "host.change-set"
    && message.changes.length > 0
    && message.changes.every(change => change.type === "session.attention-changed");
}

export function nextControlMessage(
  socket: WebSocket,
  options: { includeAttention?: boolean } = {},
): Promise<ServerMessage> {
  let state = states.get(socket);
  if (!state) {
    state = { queued: [], waiting: [] };
    states.set(socket, state);
    socket.on("message", (data: RawData) => {
      try {
        const message = serverMessageSchema.parse(JSON.parse(data.toString()));
        const waiter = state?.waiting.shift();
        waiter ? waiter.resolve(message) : state?.queued.push(message);
      } catch (error) { state?.waiting.shift()?.reject(error); }
    });
    socket.on("error", error => state?.waiting.splice(0).forEach(item => item.reject(error)));
  }
  if (options.includeAttention) {
    const queued = state.queued.shift();
    return queued
      ? Promise.resolve(queued)
      : new Promise((resolve, reject) => state?.waiting.push({ resolve, reject }));
  }
  while (state.queued.length > 0) {
    const queued = state.queued.shift()!;
    if (!isAttentionOnly(queued)) return Promise.resolve(queued);
  }
  return new Promise((resolve, reject) => {
    const await_ = () => {
      state?.waiting.push({
        resolve: message => isAttentionOnly(message) ? await_() : resolve(message),
        reject,
      });
    };
    await_();
  });
}

/** Reads the next Session attention summary broadcast. */
export async function nextAttentionChange(socket: WebSocket): Promise<{
  sessionId: string;
  attention: "quiet" | "working" | "needs-response";
  activity?: { detail?: string; at?: number };
}> {
  for (;;) {
    const message = await nextControlMessage(socket, { includeAttention: true });
    if (!isAttentionOnly(message) || message.type !== "host.change-set") continue;
    const change = message.changes[0];
    if (change?.type !== "session.attention-changed") continue;
    return { sessionId: change.sessionId, attention: change.attention, activity: change.activity };
  }
}

const states = new WeakMap<WebSocket, {
  queued: ServerMessage[];
  waiting: Array<{ resolve(message: ServerMessage): void; reject(error: unknown): void }>;
}>();

export async function synchronizeEmptyControlScope(
  socket: WebSocket,
  cursor: string,
): Promise<void> {
  socket.send(JSON.stringify({
    type: "scope.set",
    protocolVersion,
    sessionIds: [],
    cursor,
  }));
  const synchronized = await nextControlMessage(socket);
  if (synchronized.type !== "scope.current") {
    throw new Error("expected current Host scope");
  }
}

export async function negotiateControl(
  socket: WebSocket,
): Promise<HostSnapshot> {
  const offer = await nextControlMessage(socket);
  if (offer.type !== "host.hello") {
    throw new Error("expected Host hello");
  }

  socket.send(JSON.stringify(clientHello(offer.hostId)));
  const admitted = await nextControlMessage(socket);
  if (admitted.type !== "protocol.admitted") {
    throw new Error("expected protocol admission");
  }

  const snapshot = await nextControlMessage(socket);
  if (snapshot.type !== "host.snapshot") {
    throw new Error("expected Host snapshot");
  }

  await synchronizeEmptyControlScope(
    socket,
    snapshot.status.synchronization.cursor,
  );

  return snapshot;
}
