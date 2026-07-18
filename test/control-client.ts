import WebSocket, { type RawData } from "ws";
import {
  clientHello,
  serverMessageSchema,
  type HostSnapshot,
  type ServerMessage,
} from "../packages/protocol/src/status.js";

export function nextControlMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData): void => {
      socket.off("error", onError);
      try {
        resolve(serverMessageSchema.parse(JSON.parse(data.toString())));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      socket.off("message", onMessage);
      reject(error);
    };

    socket.once("message", onMessage);
    socket.once("error", onError);
  });
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

  return snapshot;
}
