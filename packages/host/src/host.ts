import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  adaptersFor,
  executePidexFirewallOperation,
  type HostAdapters,
  type WindowsPlatformAdapter,
} from "../../adapters/src/index.js";
import {
  protocolVersion,
  type HostStatus,
  type ServerMessage,
} from "../../protocol/src/status.js";
import { ensureCertificate } from "./certificate.js";
import {
  PairingAuthority,
  PairingError,
  type PairingInstructions,
} from "./pairing.js";
import {
  AuthorityStore,
  type InitialCatalog,
  type RenameOutcome,
} from "./store.js";

const DEFAULT_PORT = 7443;
const DEFAULT_HOSTNAME = "localhost";
const DEFAULT_LABEL = "Pidex Host";
const RELEASE_ID = "pidex@0.1.0";
const MAX_SESSION_NAME_LENGTH = 200;

interface PwaAsset {
  file: string;
  contentType: string;
}

interface DeviceRevokeMessage {
  type: "device.revoke";
  deviceId: string;
}

interface SessionCreateMessage {
  type: "session.create";
  commandId: string;
  projectId?: string | null;
  workspaceId?: string | null;
}

interface SessionRenameMessage {
  type: "session.rename";
  commandId: string;
  sessionId: string;
  name: string;
  requiredCapability: "session.rename";
  observedMetadataRevision: number;
}

interface ScopeSetMessage {
  type: "scope.set";
  sessionIds: string[];
  cursor?: string;
  resourceRevisions?: Record<string, number>;
  protocolVersion: string;
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
  initialCatalog?: InitialCatalog;
}

export interface StartedHost {
  origin: string;
  /** Host-local administration action. Its result must never be logged or projected. */
  createPairing(): PairingInstructions;
  status(): HostStatus;
  /** Host-local administration bypasses Device authentication. */
  revokeDevice(deviceId: string): void;
  /** Test/restore seam: continuity-breaking activation rotates the epoch atomically. */
  rotateSynchronizationEpoch(): void;
  close(): Promise<void>;
}

export async function startHost(options: HostOptions): Promise<StartedHost> {
  const adapters = options.adapters ?? adaptersFor("product");
  const store = new AuthorityStore(
    join(options.dataDir, "authority.sqlite"),
    adapters,
    options.initialCatalog,
  );
  const hostname = options.hostname ?? DEFAULT_HOSTNAME;
  const firewallPort =
    options.port && options.port > 0 ? options.port : DEFAULT_PORT;
  const certificate = ensureCertificate(
    options.dataDir,
    hostname,
    adapters.windows,
  );
  const warnings = configureFirewall(adapters.windows, firewallPort);
  const pairing = new PairingAuthority(adapters.clock, store);

  const server = createServer(
    {
      key: certificate.key,
      cert: certificate.cert,
    },
    async (request, response) => {
      const requestHost = request.headers.host?.split(":")[0];
      if (hostname !== DEFAULT_HOSTNAME && requestHost !== hostname) {
        response
          .writeHead(421, {
            location: `https://${hostname}:${options.port ?? DEFAULT_PORT}`,
          })
          .end();
        return;
      }

      if (request.method === "POST" && request.url?.startsWith("/pair/")) {
        await handlePairingRequest(request.url, request, response, pairing);
        return;
      }

      const asset = findPwaAsset(request);
      if (!asset) {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, { "content-type": asset.contentType });
      response.end(readFileSync(resolve("apps/pwa", asset.file)));
    },
  );
  const webSocketServer = new WebSocketServer({ noServer: true });
  const clientDeviceIds = new Map<WebSocket, string>();

  server.on("upgrade", (request, socket, head) => {
    const upgradeUrl = new URL(request.url ?? "/", "https://pidex.invalid");
    const sessionToken = upgradeUrl.searchParams.get("session") ?? undefined;
    const sessionDeviceId = pairing.sessionDevice(sessionToken);
    const authorization = request.headers.authorization;
    const hasValidBearerAuthorization = hasValidAuthorization(
      authorization,
      options.authorization,
      pairing,
    );
    const isAuthorizedControlRequest =
      upgradeUrl.pathname === "/control" &&
      (sessionDeviceId !== undefined || hasValidBearerAuthorization);

    if (!isAuthorizedControlRequest) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, webSocket => {
      if (sessionDeviceId !== undefined) {
        clientDeviceIds.set(webSocket, sessionDeviceId);
      } else if (hasValidBearerAuthorization) {
        const tokenDigest = createHash("sha256")
          .update(authorization ?? "")
          .digest("hex");
        clientDeviceIds.set(webSocket, `bearer:${tokenDigest}`);
      }
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", webSocket => {
    webSocket.once("close", () => clientDeviceIds.delete(webSocket));
    webSocket.on("message", bytes => {
      try {
        const message: unknown = JSON.parse(bytes.toString());
        if (isRevokeMessage(message)) {
          revokeDevice(message.deviceId);
        } else if (isSessionCreateMessage(message)) {
          handleSessionCreate(webSocket, message);
        } else if (isSessionRenameMessage(message)) {
          handleSessionRename(webSocket, message);
        } else if (isScopeSetMessage(message)) {
          synchronize(webSocket, message);
        }
      } catch {
        // Invalid and unknown commands have no authority or side effects.
      }
    });
    adapters.network.beforeSend();
    const message: ServerMessage = {
      type: "host.snapshot",
      protocolVersion,
      status: store.status(RELEASE_ID, warnings),
      ...store.projection(),
    };
    webSocket.send(JSON.stringify(message));
  });

  function synchronize(client: WebSocket, request: ScopeSetMessage): void {
    const projection = store.projection();
    const status = store.status(RELEASE_ID, warnings);
    const basis = request.cursor ? store.cursorBasis(request.cursor) : undefined;
    const protocolCompatible = request.protocolVersion === protocolVersion;
    const revisionCompatible = Object.entries(request.resourceRevisions ?? {}).every(([sessionId, expected]) => {
      const session = projection.sessions.find(item => item.sessionId === sessionId);
      return session?.metadataRevision === expected;
    });

    if (basis?.compatible && protocolCompatible && revisionCompatible) {
      for (const item of store.changesAfter(basis.sequence)) {
        const message: ServerMessage = {
          type: "host.change-set",
          cursor: item.cursor,
          changes: [item.change] as Extract<ServerMessage, { type: "host.change-set" }>["changes"],
        };
        client.send(JSON.stringify(message));
      }
      client.send(JSON.stringify({ type: "scope.current", scope: { kind: "host" }, cursor: status.synchronization.cursor } satisfies ServerMessage));
    } else {
      const reason = !protocolCompatible
        ? "protocol-mismatch"
        : !revisionCompatible
          ? "revision-mismatch"
          : basis && !basis.compatible
            ? basis.reason
            : "new-scope";
      client.send(JSON.stringify({
        type: "scope.reset",
        reason,
        barrier: {
          scope: { kind: "host" }, cursor: status.synchronization.cursor,
          resourceRevisions: Object.fromEntries(projection.sessions.map(session => [session.sessionId, session.metadataRevision])),
          protocolBasis: protocolVersion,
          capabilities: ["session.create", "session.rename", "scope.session"],
        },
        snapshot: projection,
      } satisfies ServerMessage));
    }

    for (const sessionId of request.sessionIds) {
      const session = projection.sessions.find(item => item.sessionId === sessionId);
      if (!session) continue;
      client.send(JSON.stringify({
        type: "scope.reset", reason: "new-scope",
        barrier: {
          scope: { kind: "session", sessionId }, cursor: status.synchronization.cursor,
          resourceRevisions: { metadata: session.metadataRevision, timeline: session.timelineRevision },
          protocolBasis: protocolVersion, capabilities: ["session.rename"],
        },
        snapshot: { session },
      } satisfies ServerMessage));
    }
  }

  await new Promise<void>((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(
      options.port ?? DEFAULT_PORT,
      options.bindAddress ?? "0.0.0.0",
      resolveStart,
    );
  });

  const address = server.address();
  const port =
    address && typeof address === "object"
      ? address.port
      : (options.port ?? DEFAULT_PORT);

  const canonicalOrigin = `https://${hostname}:${port}`;
  const fingerprint = createHash("sha256")
    .update(certificate.ca)
    .digest("hex");
  const stopAdvertisement = adapters.windows.advertisePidex({
    service: "_pidex._tcp.local",
    hostname,
    port,
    interfaces: adapters.windows.privateInterfaces(),
    txt: {
      location: canonicalOrigin,
      label: options.label ?? DEFAULT_LABEL,
      version: "1",
      fingerprint,
    },
  });

  function revokeDevice(deviceId: string): void {
    pairing.revoke(deviceId);
    for (const [client, connectedDeviceId] of clientDeviceIds) {
      if (connectedDeviceId === deviceId) {
        client.close(4003, "device-revoked");
      }
    }
  }

  function handleSessionCreate(
    client: WebSocket,
    command: SessionCreateMessage,
  ): void {
    try {
      adapters.storage.beforeCommit();
      const created = store.createSession(
        command.projectId ?? null,
        command.workspaceId ?? null,
        adapters.clock.now(),
      );
      const outcome: ServerMessage = {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "accepted",
      };
      client.send(JSON.stringify(outcome));

      const changeSet: ServerMessage = {
        type: "host.change-set",
        cursor: created.cursor,
        changes: [{ type: "session.created", session: created.session }],
      };
      for (const socket of webSocketServer.clients) {
        socket.send(JSON.stringify(changeSet));
      }
    } catch (error) {
      const outcome: ServerMessage = {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: error instanceof Error ? error.message : "invalid-scope",
      };
      client.send(JSON.stringify(outcome));
    }
  }

  function handleSessionRename(
    client: WebSocket,
    command: SessionRenameMessage,
  ): void {
    const deviceId = clientDeviceIds.get(client);
    if (!deviceId) {
      return;
    }

    try {
      adapters.storage.beforeCommit();
      const result = store.renameSession(
        deviceId,
        command,
        adapters.clock.now(),
      );
      if (result.kind === "command-id-conflict") {
        const conflict: ServerMessage = {
          type: "command.outcome",
          commandId: command.commandId,
          outcome: "rejected",
          error: "command-id-conflict",
        };
        client.send(JSON.stringify(conflict));
        return;
      }

      const resolved = result.kind === "replayed" ? result.outcome : result;
      client.send(
        JSON.stringify(renameOutcomeMessage(command.commandId, resolved)),
      );

      if (resolved.kind === "accepted" && result.kind !== "replayed") {
        const changeSet: ServerMessage = {
          type: "host.change-set",
          cursor: resolved.cursor,
          changes: [
            { type: "session.renamed", session: resolved.session },
          ],
        };
        for (const socket of webSocketServer.clients) {
          socket.send(JSON.stringify(changeSet));
        }
      }
    } catch {
      const failure: ServerMessage = {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: "commit-failed",
      };
      client.send(JSON.stringify(failure));
    }
  }

  return {
    origin: canonicalOrigin,
    createPairing: () => pairing.create(canonicalOrigin),
    status: () => store.status(RELEASE_ID, warnings),
    revokeDevice,
    rotateSynchronizationEpoch: () => store.rotateSynchronizationEpoch(adapters.clock.now()),
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

function isScopeSetMessage(value: unknown): value is ScopeSetMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.type === "scope.set" && typeof item.protocolVersion === "string" &&
    Array.isArray(item.sessionIds) && item.sessionIds.every(id => typeof id === "string") &&
    (item.cursor === undefined || typeof item.cursor === "string") &&
    (item.resourceRevisions === undefined || (typeof item.resourceRevisions === "object" && item.resourceRevisions !== null));
}

function isSessionCreateMessage(value: unknown): value is SessionCreateMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const hasValidProject =
    !("projectId" in value) ||
    value.projectId === undefined ||
    value.projectId === null ||
    typeof value.projectId === "string";
  const hasValidWorkspace =
    !("workspaceId" in value) ||
    value.workspaceId === undefined ||
    value.workspaceId === null ||
    typeof value.workspaceId === "string";

  return (
    "type" in value &&
    value.type === "session.create" &&
    "commandId" in value &&
    typeof value.commandId === "string" &&
    hasValidProject &&
    hasValidWorkspace
  );
}

function isSessionRenameMessage(value: unknown): value is SessionRenameMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "type" in value &&
    value.type === "session.rename" &&
    "commandId" in value &&
    typeof value.commandId === "string" &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= MAX_SESSION_NAME_LENGTH &&
    "requiredCapability" in value &&
    value.requiredCapability === "session.rename" &&
    "observedMetadataRevision" in value &&
    typeof value.observedMetadataRevision === "number" &&
    Number.isSafeInteger(value.observedMetadataRevision) &&
    value.observedMetadataRevision > 0
  );
}

function renameOutcomeMessage(
  commandId: string,
  outcome: RenameOutcome,
): ServerMessage {
  const receipt = {
    digest: outcome.digest,
    commitCursor: outcome.cursor,
  };
  if (outcome.kind === "accepted") {
    return {
      type: "command.outcome",
      commandId,
      outcome: "accepted",
      receipt,
    };
  }

  if (outcome.error === "stale-precondition") {
    return {
      type: "command.outcome",
      commandId,
      outcome: "rejected",
      error: outcome.error,
      receipt,
      failedPrecondition: "metadataRevision",
      currentMetadataRevision: outcome.currentMetadataRevision,
      reconciliationCursor: outcome.cursor,
    };
  }

  return {
    type: "command.outcome",
    commandId,
    outcome: "rejected",
    error: outcome.error,
    receipt,
  };
}

function findPwaAsset(request: IncomingMessage): PwaAsset | undefined {
  const asset = PWA_ASSETS[request.url ?? ""];
  if (asset) {
    return asset;
  }
  if (request.method === "GET" && request.url?.startsWith("/sessions/")) {
    return PWA_ASSETS["/"];
  }
  return undefined;
}

function isRevokeMessage(value: unknown): value is DeviceRevokeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "type" in value &&
    value.type === "device.revoke" &&
    "deviceId" in value &&
    typeof value.deviceId === "string"
  );
}

function configureFirewall(
  windows: WindowsPlatformAdapter,
  port: number,
): HostStatus["warnings"] {
  executePidexFirewallOperation(windows, {
    operation: "ensure-private-rule",
    port,
  });

  const firewall = windows.inspectPidexFirewall(port);
  if (firewall.state === "healthy") {
    return [];
  }

  const warning: HostStatus["warnings"][number] = {
    severity: "high",
    code: "firewall-enforcement-degraded",
    detail: firewall.detail,
  };
  windows.writeCoarseEvent({
    severity: "error",
    code: "PIDEX_FIREWALL_DEGRADED",
    detail: warning.detail,
  });
  console.error(JSON.stringify(warning));

  return [warning];
}

function hasValidAuthorization(
  header: string | undefined,
  expected: string | undefined,
  pairing: PairingAuthority,
): boolean {
  if (!header?.startsWith("Bearer ")) {
    return false;
  }

  const token = header.slice(7);
  if (pairing.acceptsSession(token)) {
    return true;
  }
  if (!expected) {
    return false;
  }

  const actual = Buffer.from(token);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

async function handlePairingRequest(
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  pairing: PairingAuthority,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const part = Buffer.from(chunk);
      size += part.length;
      if (size > 16_384) {
        throw new PairingError(413, "request-too-large");
      }
      chunks.push(part);
    }

    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new PairingError(400, "invalid-json");
    }

    const result = routePairingRequest(path, body, pairing);
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(result));
  } catch (error) {
    const failure =
      error instanceof PairingError
        ? error
        : new PairingError(400, "invalid-request");
    response.writeHead(failure.status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ error: failure.message }));
  }
}

function routePairingRequest(
  path: string,
  body: unknown,
  pairing: PairingAuthority,
): object {
  switch (path) {
    case "/pair/challenge":
      return pairing.begin(
        pairingRequestField(body, "secret"),
        pairingRequestField(body, "publicKey"),
      );
    case "/pair/complete":
      return pairing.complete(
        pairingRequestField(body, "pairingId"),
        pairingRequestField(body, "signature"),
      );
    case "/pair/auth-challenge":
      return pairing.beginAuthentication(pairingRequestField(body, "deviceId"));
    case "/pair/authenticate":
      return pairing.authenticate(
        pairingRequestField(body, "authenticationId"),
        pairingRequestField(body, "signature"),
      );
    default:
      throw new PairingError(404, "not-found");
  }
}

function pairingRequestField(body: unknown, field: string): unknown {
  if (body === null || body === undefined) {
    throw new PairingError(400, "invalid-request");
  }
  return Reflect.get(Object(body), field);
}
