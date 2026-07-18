import type { ServerMessage } from "../../protocol/src/status.js";
import WebSocket from "ws";

export async function readStatus(origin: string): Promise<ServerMessage["status"]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace(/^https:/, "wss:") + "/control", { rejectUnauthorized: false });
    ws.once("message", data => { const message = JSON.parse(data.toString()) as ServerMessage; ws.close(); resolve(message.status); });
    ws.once("error", reject);
  });
}

if (process.argv[1]?.endsWith("main.ts")) {
  if (process.argv[2] !== "status") throw new Error("Usage: pidex status");
  const status = await readStatus(process.env.PIDEX_ORIGIN ?? "https://127.0.0.1:7443");
  console.log(`Host identity: ${status.hostId}\nRelease identity: ${status.releaseId}\nReadiness: ${status.readiness}\nSynchronization basis: ${status.synchronization.cursor}`);
}
