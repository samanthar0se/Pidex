import WebSocket from "ws";
import {
  clientHello,
  serverMessageSchema,
  type HostStatus,
} from "../../protocol/src/status.js";

/** Legacy Device-protocol helper retained for existing public-protocol parity tests. */
export async function readStatus(
  origin: string,
  authorization?: string,
): Promise<HostStatus> {
  return new Promise((resolve, reject) => {
    const controlOrigin = origin.replace(/^https:/, "wss:");
    const controlSocket = new WebSocket(`${controlOrigin}/control`, {
      rejectUnauthorized: false,
      headers: authorization
        ? { authorization: `Bearer ${authorization}` }
        : undefined,
    });

    controlSocket.on("message", data => {
      try {
        const message = serverMessageSchema.parse(
          JSON.parse(data.toString()),
        );
        switch (message.type) {
          case "host.hello":
            controlSocket.send(JSON.stringify(clientHello(message.hostId)));
            break;
          case "host.snapshot":
            controlSocket.close();
            resolve(message.status);
            break;
          case "protocol.update-required":
            throw new Error(`Pidex update required: ${message.reason}`);
        }
      } catch (error) {
        controlSocket.close();
        reject(error);
      }
    });
    controlSocket.once("error", reject);
  });
}
