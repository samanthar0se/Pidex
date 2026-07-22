import WebSocket, { type RawData } from "ws";
import {
  clientHello,
  hostStatusSchema,
  protocolVersion,
  serverMessageSchema,
  type HostStatus,
  type ServerMessage,
} from "../../protocol/src/status.js";

export const PIDEX_COMMANDS = Object.freeze(["status", "doctor"] as const);
const DEFAULT_HOSTS = { development: "http://127.0.0.1:7443", packaged: "http://127.0.0.1:47831" } as const;

type Output = { stdout(value: string): void; stderr(value: string): void };

export function resolveHostUrl(argv: readonly string[], env: NodeJS.ProcessEnv): URL {
  const hostIndex = argv.indexOf("--host");
  const profileIndex = argv.indexOf("--profile");
  const profile = profileIndex >= 0 ? argv[profileIndex + 1] : env.PIDEX_PROFILE ?? "development";
  if (profile !== "development" && profile !== "packaged") throw new Error("profile must be development or packaged");
  const raw = hostIndex >= 0 ? argv[hostIndex + 1] : env.PIDEX_HOST_URL ?? DEFAULT_HOSTS[profile];
  if (!raw) throw new Error("--host requires an HTTP Host URL");
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Host URL must be an ordinary HTTP origin without credentials, path, query, or fragment");
  }
  return url;
}

export async function runCli(argv: readonly string[], env: NodeJS.ProcessEnv, output: Output): Promise<number> {
  try {
    const positional = argv.filter((argument, index) =>
      !argument.startsWith("--") && argv[index - 1] !== "--host" && argv[index - 1] !== "--profile");
    const command = positional[0];
    if (command !== "status" && command !== "doctor") throw new Error("Usage: pidex <status|doctor> [--host <http-origin>] [--json]");
    const host = resolveHostUrl(argv, env);
    const status = await admitAndSynchronize(host);
    if (command === "status") {
      output.stdout(argv.includes("--json") ? JSON.stringify(status) : formatStatus(status));
      return 0;
    }
    const response = await fetch(new URL("/api/doctor", host), { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`doctor request failed (${response.status})`);
    const report: unknown = await response.json();
    output.stdout(argv.includes("--json") ? JSON.stringify(report) : formatDoctor(report));
    return 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return /compatib|protocol|capability/.test(String(error)) ? 3 : 2;
  }
}

async function admitAndSynchronize(host: URL): Promise<HostStatus> {
  const socketUrl = new URL("/control", host);
  socketUrl.protocol = "ws:";
  const socket = new WebSocket(socketUrl);
  const messages = messageReader(socket);
  try {
    const offer = await messages.next();
    if (offer.type !== "host.hello") throw new Error("Host compatibility hello was not received");
    socket.send(JSON.stringify(clientHello(offer.hostId)));
    const admission = await messages.next();
    if (admission.type === "protocol.update-required") throw new Error(`protocol incompatible: ${admission.reason}`);
    if (admission.type !== "protocol.admitted") throw new Error("Host did not admit CLI compatibility");
    const snapshot = await messages.next();
    if (snapshot.type !== "host.snapshot") throw new Error("Host status snapshot was not received");
    socket.send(JSON.stringify({
      type: "scope.set", protocolVersion, sessionIds: [], cursor: snapshot.status.synchronization.cursor,
    }));
    const current = await messages.next();
    if (current.type !== "scope.current") throw new Error("Host synchronization did not complete");
    return hostStatusSchema.parse(snapshot.status);
  } finally {
    socket.close();
  }
}

function messageReader(socket: WebSocket): { next(): Promise<ServerMessage> } {
  const queued: ServerMessage[] = [];
  const waiting: Array<{ resolve(value: ServerMessage): void; reject(error: unknown): void }> = [];
  socket.on("message", (data: RawData) => {
    try {
      const value = serverMessageSchema.parse(JSON.parse(data.toString()));
      const waiter = waiting.shift();
      waiter ? waiter.resolve(value) : queued.push(value);
    } catch (error) { waiting.shift()?.reject(error); }
  });
  socket.on("error", error => waiting.splice(0).forEach(waiter => waiter.reject(error)));
  return { next: () => {
    const value = queued.shift();
    return value ? Promise.resolve(value) : new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  } };
}

function formatStatus(status: HostStatus): string {
  return `Host: ${status.readiness}\nRelease: ${status.releaseId}\nDurability: ${status.durability.aggregate}`;
}

function formatDoctor(report: unknown): string {
  if (typeof report === "object" && report && "outcome" in report) return `Doctor: ${String(report.outcome)}`;
  return "Doctor report complete";
}
