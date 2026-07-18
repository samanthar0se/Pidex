import WebSocket from "ws";
import {
  clientHello,
  serverMessageSchema,
  type HostSnapshot,
  type ServerMessage,
} from "../packages/protocol/src/status.js";

export function nextControlMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", data => {
      try { resolve(serverMessageSchema.parse(JSON.parse(data.toString()))); }
      catch (error) { reject(error); }
    });
    socket.once("error", reject);
  });
}

export async function negotiateControl(socket: WebSocket): Promise<HostSnapshot> {
  const offer = await nextControlMessage(socket);
  if (offer.type !== "host.hello") throw new Error("expected Host hello");
  socket.send(JSON.stringify(clientHello(offer.hostId)));
  const admitted = await nextControlMessage(socket);
  if (admitted.type !== "protocol.admitted") throw new Error("expected protocol admission");
  const snapshot = await nextControlMessage(socket);
  if (snapshot.type !== "host.snapshot") throw new Error("expected Host snapshot");
  return snapshot;
}
