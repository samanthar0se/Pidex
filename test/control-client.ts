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

export function nextControlMessage(socket: WebSocket): Promise<ServerMessage> {
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
  const message = state.queued.shift();
  return message ? Promise.resolve(message) : new Promise((resolve, reject) => state?.waiting.push({ resolve, reject }));
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
