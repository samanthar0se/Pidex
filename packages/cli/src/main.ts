import WebSocket from "ws";
import {
  parseServerMessage,
  type HostStatus,
} from "../../protocol/src/status.js";

export async function readStatus(origin: string): Promise<HostStatus> {
  return new Promise((resolve, reject) => {
    const controlOrigin = origin.replace(/^https:/, "wss:");
    const controlSocket = new WebSocket(`${controlOrigin}/control`, {
      rejectUnauthorized: false,
    });

    controlSocket.once("message", data => {
      try {
        const message = parseServerMessage(data.toString());
        controlSocket.close();
        resolve(message.status);
      } catch (error) {
        controlSocket.close();
        reject(error);
      }
    });
    controlSocket.once("error", reject);
  });
}

if (process.argv[1]?.endsWith("main.ts")) {
  if (process.argv[2] !== "status") {
    throw new Error("Usage: pidex status");
  }

  const status = await readStatus(
    process.env.PIDEX_ORIGIN ?? "https://127.0.0.1:7443",
  );
  console.log(
    [
      `Host identity: ${status.hostId}`,
      `Release identity: ${status.releaseId}`,
      `Readiness: ${status.readiness}`,
      `Synchronization basis: ${status.synchronization.cursor}`,
    ].join("\n"),
  );
}
