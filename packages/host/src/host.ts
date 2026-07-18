import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { WebSocketServer } from "ws";
import { AuthorityStore } from "./store.js";
import { ensureCertificate } from "./certificate.js";
import { adaptersFor, type HostAdapters } from "../../adapters/src/index.js";
import { protocolVersion, type ServerMessage } from "../../protocol/src/status.js";

export interface HostOptions { dataDir: string; port?: number; adapters?: HostAdapters }

export async function startHost(options: HostOptions) {
  const adapters = options.adapters ?? adaptersFor("product");
  const store = new AuthorityStore(join(options.dataDir, "authority.sqlite"), adapters);
  const tls = ensureCertificate(options.dataDir);
  const releaseId = "pidex@0.1.0";
  const server = createServer({ key: readFileSync(tls.key), cert: readFileSync(tls.cert) }, (req, res) => {
    const files: Record<string,string> = { "/": "index.html", "/app.js": "app.js", "/manifest.webmanifest": "manifest.webmanifest" };
    const file = files[req.url ?? ""];
    if (!file) { res.writeHead(404).end(); return; }
    const types: Record<string,string> = { "index.html":"text/html", "app.js":"text/javascript", "manifest.webmanifest":"application/manifest+json" };
    res.writeHead(200, { "content-type": types[file] });
    res.end(readFileSync(resolve("apps/pwa", file)));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/control") { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
  });
  wss.on("connection", ws => {
    adapters.network.beforeSend();
    const message: ServerMessage = { type: "host.snapshot", protocolVersion, status: store.status(releaseId) };
    ws.send(JSON.stringify(message));
  });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(options.port ?? 7443, "127.0.0.1", ok); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port ?? 7443;
  return { origin: `https://127.0.0.1:${port}`, status: () => store.status(releaseId), close: async () => { for (const ws of wss.clients) ws.close(); wss.close(); await new Promise<void>((ok, fail) => server.close(e => e ? fail(e) : ok())); store.close(); } };
}
