import WebSocket from "ws";
import {
  clientHello,
  serverMessageSchema,
  type HostStatus,
} from "../packages/protocol/src/status.js";

/** Test-only Device-protocol helper for public-protocol parity evidence. */
export async function readStatus(origin: string, authorization?: string): Promise<HostStatus> {
  return new Promise((resolve, reject) => {
    const controlSocket = new WebSocket(`${origin.replace(/^https:/, "wss:")}/control`, {
      rejectUnauthorized: false,
      headers: authorization ? { authorization: `Bearer ${authorization}` } : undefined,
    });
    controlSocket.on("message", data => {
      try {
        const message = serverMessageSchema.parse(JSON.parse(data.toString()));
        if (message.type === "host.hello") controlSocket.send(JSON.stringify(clientHello(message.hostId)));
        if (message.type === "host.snapshot") { controlSocket.close(); resolve(message.status); }
        if (message.type === "protocol.update-required") throw new Error(`Pidex update required: ${message.reason}`);
      } catch (error) { controlSocket.close(); reject(error); }
    });
    controlSocket.once("error", reject);
  });
}
