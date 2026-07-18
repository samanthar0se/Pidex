import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { adaptersFor, executePidexFirewallOperation, type HostAdapters } from "../../adapters/src/index.js";
import {
  protocolVersion,
  type HostStatus,
  type ServerMessage,
} from "../../protocol/src/status.js";
import { ensureCertificate } from "./certificate.js";
import { AuthorityStore } from "./store.js";

const DEFAULT_PORT = 7443;
const RELEASE_ID = "pidex@0.1.0";

interface PwaAsset {
  file: string;
  contentType: string;
}

const PWA_ASSETS: Record<string, PwaAsset> = {
  "/": { file: "index.html", contentType: "text/html" },
  "/app.js": { file: "app.js", contentType: "text/javascript" },
  "/manifest.webmanifest": {
    file: "manifest.webmanifest",
    contentType: "application/manifest+json",
  },
};

export interface HostOptions {
  dataDir: string;
  port?: number;
  adapters?: HostAdapters;
  hostname?: string;
  label?: string;
  authorization?: string;
  bindAddress?: string;
}

export interface StartedHost {
  origin: string;
  status(): HostStatus;
  close(): Promise<void>;
}

export async function startHost(options: HostOptions): Promise<StartedHost> {
  const adapters = options.adapters ?? adaptersFor("product");
  const store = new AuthorityStore(join(options.dataDir, "authority.sqlite"), adapters);
  const hostname = options.hostname ?? "localhost";
  const firewallPort = options.port && options.port > 0 ? options.port : DEFAULT_PORT;
  const certificate = ensureCertificate(options.dataDir, hostname, adapters.windows);
  executePidexFirewallOperation(adapters.windows, { operation: "ensure-private-rule", port: firewallPort });
  const firewall = adapters.windows.inspectPidexFirewall(firewallPort);
  const warnings: HostStatus["warnings"] = firewall.state === "healthy" ? [] : [{
    severity: "high", code: "firewall-enforcement-degraded", detail: firewall.detail,
  }];
  if (warnings[0]) {
    adapters.windows.writeCoarseEvent({ severity: "error", code: "PIDEX_FIREWALL_DEGRADED", detail: warnings[0].detail });
    console.error(JSON.stringify({ severity: "high", code: warnings[0].code, detail: warnings[0].detail }));
  }
  const server = createServer(
    {
      key: certificate.key,
      cert: certificate.cert,
    },
    (request, response) => {
      const requestHost = request.headers.host?.split(":")[0];
      if (hostname !== "localhost" && requestHost !== hostname) {
        response.writeHead(421, { location: `https://${hostname}:${options.port ?? DEFAULT_PORT}` }).end();
        return;
      }
      const asset = PWA_ASSETS[request.url ?? ""];
      if (!asset) {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, { "content-type": asset.contentType });
      response.end(readFileSync(resolve("apps/pwa", asset.file)));
    },
  );
  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/control" || !authorized(request.headers.authorization, options.authorization)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, webSocket => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", webSocket => {
    adapters.network.beforeSend();
    const message: ServerMessage = {
      type: "host.snapshot",
      protocolVersion,
      status: store.status(RELEASE_ID, warnings),
    };
    webSocket.send(JSON.stringify(message));
  });

  await new Promise<void>((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(options.port ?? DEFAULT_PORT, options.bindAddress ?? "0.0.0.0", resolveStart);
  });

  const address = server.address();
  const port =
    typeof address === "object" && address
      ? address.port
      : (options.port ?? DEFAULT_PORT);

  const canonicalOrigin = `https://${hostname}:${port}`;
  const stopAdvertisement = adapters.windows.advertisePidex({
    service: "_pidex._tcp.local", hostname, port,
    interfaces: adapters.windows.privateInterfaces(),
    txt: { location: canonicalOrigin, label: options.label ?? "Pidex Host", version: "1", fingerprint: createHash("sha256").update(certificate.ca).digest("hex") },
  });
  return {
    origin: canonicalOrigin,
    status: () => store.status(RELEASE_ID, warnings),
    close: async () => {
      stopAdvertisement();
      for (const webSocket of webSocketServer.clients) {
        webSocket.close();
      }
      webSocketServer.close();

      await new Promise<void>((resolveClose, rejectClose) => {
        server.close(error => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
      store.close();
    },
  };
}

function authorized(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
