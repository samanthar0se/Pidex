import WebSocket from "ws";
import {
  clientHello,
  serverMessageSchema,
  type HostStatus,
} from "../../protocol/src/status.js";
export { CliControlClient, projectStatus, resolveCliTarget } from "./local-control.js";

/**
 * Operations exposed by the signed CLI entry point. Product packaging delegates
 * mutating operations to authenticated launcher and Host adapters.
 */
export const PIDEX_COMMANDS = Object.freeze([
  "status",
  "start",
  "retry",
  "stop",
  "restart",
  "pairing",
  "revoke",
  "origin",
  "certificate",
  "firewall",
  "update",
  "logs",
  "backup",
  "restore",
  "recovery",
  "doctor",
  "support",
  "operation",
  "unprepare",
  "purge",
] as const);

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

/* Legacy Device-protocol helper retained only for existing public-protocol
 * parity tests. CLI command dispatch must use CliControlClient/local control. */

if (process.argv[1]?.endsWith("main.ts")) {
  const command = process.argv[2];
  const isKnownCommand = PIDEX_COMMANDS.some(candidate => candidate === command);

  if (!isKnownCommand) {
    throw new Error(`Usage: pidex <${PIDEX_COMMANDS.join("|")}>`);
  }
  throw new Error(
    `${command} requires the manifest-selected authenticated local-control adapter`,
  );
}
