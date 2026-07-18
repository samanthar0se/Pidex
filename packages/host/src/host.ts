import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { adaptersFor, type HostAdapters } from "../../adapters/src/index.js";
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
}

export interface StartedHost {
  origin: string;
  status(): HostStatus;
  close(): Promise<void>;
}

export async function startHost(options: HostOptions): Promise<StartedHost> {
  const adapters = options.adapters ?? adaptersFor("product");
  const store = new AuthorityStore(join(options.dataDir, "authority.sqlite"), adapters);
  const certificate = ensureCertificate(options.dataDir, "localhost", adapters.windows);
  const server = createServer(
    {
      key: certificate.key,
      cert: certificate.cert,
    },
    (request, response) => {
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
    if (request.url !== "/control") {
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
      status: store.status(RELEASE_ID),
    };
    webSocket.send(JSON.stringify(message));
  });

  await new Promise<void>((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(options.port ?? DEFAULT_PORT, "127.0.0.1", resolveStart);
  });

  const address = server.address();
  const port =
    typeof address === "object" && address
      ? address.port
      : (options.port ?? DEFAULT_PORT);

  return {
    origin: `https://127.0.0.1:${port}`,
    status: () => store.status(RELEASE_ID),
    close: async () => {
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
