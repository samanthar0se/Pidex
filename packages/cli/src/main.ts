import WebSocket from "ws";
import {
  clientHello,
  serverMessageSchema,
  type HostStatus,
} from "../../protocol/src/status.js";

/**
 * Operations exposed by the signed CLI entry point. Product packaging delegates
 * mutating operations to authenticated launcher and Host adapters.
 */
export const PIDEX_COMMANDS = Object.freeze([
  "status",
  "start",
  "retry",
  "pairing",
  "revoke",
  "origin",
  "certificate",
  "firewall",
  "update",
  "logs",
  "backup",
  "recovery",
  "doctor",
  "support",
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

if (process.argv[1]?.endsWith("main.ts")) {
  const command = process.argv[2];
  const isKnownCommand = PIDEX_COMMANDS.some(candidate => candidate === command);

  if (!isKnownCommand) {
    throw new Error(`Usage: pidex <${PIDEX_COMMANDS.join("|")}>`);
  }
  if (command !== "status") {
    throw new Error(
      `${command} requires the installed signed launcher adapter`,
    );
  }

  const status = await readStatus(
    process.env.PIDEX_ORIGIN ?? "https://localhost:7443",
    process.env.PIDEX_AUTHORIZATION,
  );
  console.log(
    [
      `Host identity: ${status.hostId}`,
      `Release identity: ${status.releaseId}`,
      `Readiness: ${status.readiness}`,
      ...status.warnings.map(warning => `HIGH: ${warning.detail}`),
      `Synchronization basis: ${status.synchronization.cursor}`,
    ].join("\n"),
  );
}
