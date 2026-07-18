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
  clientHelloSchema,
  protocolCapabilities,
  protocolMajor,
  protocolMinor,
  protocolVersion,
  type ClientHello,
  type HostStatus,
  type ServerMessage,
} from "../../protocol/src/status.js";
import { ensureCertificate } from "./certificate.js";
import {
  PairingAuthority,
  PairingError,
  type PairingInstructions,
} from "./pairing.js";
import { PiSessionWorker } from "./pi-worker.js";
import {
  AuthorityStore,
  type InitialCatalog,
  type RenameOutcome,
  type SubmitCommand,
  type SubmitOutcome,
} from "./store.js";

const DEFAULT_PORT = 7443;
const DEFAULT_HOSTNAME = "localhost";
const DEFAULT_LABEL = "Pidex Host";
const RELEASE_ID = "pidex@0.1.0";
const MAX_SESSION_NAME_LENGTH = 200;
const MAX_RUN_PROMPT_LENGTH = 100_000;
const DEFAULT_MAX_OUTBOUND_BYTES = 256 * 1024;
const REQUIRED_CLIENT_CAPABILITIES = ["scope.host", "session.create"];
const INTERNAL_WORKER_CAPABILITIES = new Set([
  "run.execute",
  "checkpoint.durable",
]);

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

interface CapabilityBasisRequirement {
  id: string;
  version: number;
}

interface RunSubmitMessage extends SubmitCommand {
  type: "run.submit";
  requiredCapabilityBasis?: CapabilityBasisRequirement[];
}

interface ScopeSetMessage {
  type: "scope.set";
  sessionIds: string[];
  cursor?: string;
  resourceRevisions?: Record<string, number>;
  protocolVersion: string;
}

type ScopeResetReason = Extract<
  ServerMessage,
  { type: "scope.reset" }
>["reason"];

type ProtocolUpdateReason = Extract<
  ServerMessage,
  { type: "protocol.update-required" }
>["reason"];

interface OutboundMessage {
  payload: string;
  bytes: number;
  replaceKey?: string;
}

interface ClientDelivery {
  outboundBytes: number;
  sending: boolean;
  queue: OutboundMessage[];
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
  /** Per-Client delivery bound; exceeding it disconnects only that Client. */
  maxOutboundBytes?: number;
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
  // Refuse to advertise or accept authority until the exact worker generation
  // has proved the daily-driver semantic baseline.
  const workerCapabilities = await PiSessionWorker.probe(adapters.pi);
  const runtimeCapabilities = workerCapabilities
    .filter(capability => !INTERNAL_WORKER_CAPABILITIES.has(capability.id))
    .map(capability => ({
      id: `pi.${capability.id}`,
      version: capability.version,
      constraints: capability.constraints,
    }));
  const hostCapabilities = [...protocolCapabilities, ...runtimeCapabilities];
  const store = new AuthorityStore(
    join(options.dataDir, "authority.sqlite"),
    adapters,
    options.initialCatalog,
  );
  // An executing tail surviving daemon loss has no proof of normal completion.
  // Settle it conservatively and never dispatch it again to discover the result.
  store.reconcileAcceptedRuns(adapters.clock.now());
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
  const admittedClients = new Set<WebSocket>();
  const admittedCapabilityBasisByClient = new Map<WebSocket, Set<string>>();
  const sessionScopesByClient = new Map<WebSocket, Set<string>>();
  const maxOutboundBytes =
    options.maxOutboundBytes ?? DEFAULT_MAX_OUTBOUND_BYTES;
  const deliveries = new Map<WebSocket, ClientDelivery>();
  const workers = new Map<string, PiSessionWorker>();

  function sendServerMessage(client: WebSocket, message: ServerMessage): void {
    if (client.readyState !== client.OPEN) {
      return;
    }

    const payload = JSON.stringify(message);
    const payloadBytes = Buffer.byteLength(payload);
    let delivery = deliveries.get(client);
    if (!delivery) {
      delivery = { outboundBytes: 0, sending: false, queue: [] };
      deliveries.set(client, delivery);
    }

    const replaceKey = replaceableChangeKey(message);
    const replacement = replaceKey
      ? delivery.queue.find(item => item.replaceKey === replaceKey)
      : undefined;
    const replacementBytes = replacement?.bytes ?? 0;
    const prospectiveBytes =
      delivery.outboundBytes + payloadBytes - replacementBytes;

    if (prospectiveBytes > maxOutboundBytes) {
      client.send(
        JSON.stringify({
          type: "delivery.resynchronize",
          reason: "outbound-queue-overflow",
          lastCursor: store.status(RELEASE_ID, warnings).synchronization.cursor,
        } satisfies ServerMessage),
      );
      client.close(4009, "resynchronize:outbound-queue-overflow");
      return;
    }

    if (replacement) {
      delivery.outboundBytes = prospectiveBytes;
      replacement.payload = payload;
      replacement.bytes = payloadBytes;
    } else {
      delivery.outboundBytes += payloadBytes;
      delivery.queue.push({ payload, bytes: payloadBytes, replaceKey });
    }

    drainDelivery(client, delivery);
  }

  function drainDelivery(client: WebSocket, delivery: ClientDelivery): void {
    if (delivery.sending || client.readyState !== client.OPEN) {
      return;
    }

    const item = delivery.queue.shift();
    if (!item) {
      return;
    }

    delivery.sending = true;
    adapters.network.beforeSend();
    client.send(item.payload, error => {
      delivery.sending = false;
      delivery.outboundBytes -= item.bytes;
      if (error) {
        client.close();
        return;
      }
      drainDelivery(client, delivery);
    });
  }

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
    webSocket.once("close", () => {
      clientDeviceIds.delete(webSocket);
      admittedClients.delete(webSocket);
      admittedCapabilityBasisByClient.delete(webSocket);
      sessionScopesByClient.delete(webSocket);
      deliveries.delete(webSocket);
    });
    webSocket.on("message", bytes => {
      try {
        const message: unknown = JSON.parse(bytes.toString());
        if (!admittedClients.has(webSocket)) {
          const hello = clientHelloSchema.safeParse(message);
          if (hello.success) negotiate(webSocket, hello.data);
        } else if (isRevokeMessage(message)) {
          revokeDevice(message.deviceId);
        } else if (isSessionCreateMessage(message)) {
          handleSessionCreate(webSocket, message);
        } else if (isSessionRenameMessage(message)) {
          handleSessionRename(webSocket, message);
        } else if (isRunSubmitMessage(message)) {
          handleRunSubmit(webSocket, message);
        } else if (isScopeSetMessage(message)) {
          synchronize(webSocket, message);
        }
      } catch {
        // Invalid and unknown commands have no authority or side effects.
      }
    });
    sendServerMessage(webSocket, {
      type: "host.hello",
      hostId: store.status(RELEASE_ID, warnings).hostId,
      protocols: [{ major: protocolMajor, minor: protocolMinor }],
      capabilities: hostCapabilities,
    });
  });

  function negotiate(client: WebSocket, hello: ClientHello): void {
    const status = store.status(RELEASE_ID, warnings);
    if (hello.expectedHostId !== status.hostId) {
      sendProtocolUpdateRequired(client, status.hostId, "host-mismatch");
      return;
    }

    const offered = hello.protocols
      .filter(protocol => protocol.major === protocolMajor)
      .sort((a, b) => b.minor - a.minor)[0];
    if (!offered) {
      sendProtocolUpdateRequired(client, status.hostId, "no-common-major");
      return;
    }

    const admittedCapabilities = hostCapabilities.filter(hostCapability =>
      hello.capabilities.some(clientCapability =>
        clientCapability.id === hostCapability.id &&
        (clientCapability.minVersion ?? 1) <= hostCapability.version &&
        (clientCapability.maxVersion ?? Number.MAX_SAFE_INTEGER) >=
          hostCapability.version,
      ),
    );
    const missingRequiredCapability = REQUIRED_CLIENT_CAPABILITIES.some(
      requiredId =>
        !admittedCapabilities.some(capability => capability.id === requiredId),
    );
    if (missingRequiredCapability) {
      sendProtocolUpdateRequired(client, status.hostId, "missing-capability");
      return;
    }

    admittedClients.add(client);
    admittedCapabilityBasisByClient.set(
      client,
      new Set(admittedCapabilities.map(capabilityBasisKey)),
    );
    sendServerMessage(client, {
      type: "protocol.admitted",
      hostId: status.hostId,
      protocol: {
        major: protocolMajor,
        minor: Math.min(protocolMinor, offered.minor),
      },
      capabilities: admittedCapabilities.map(item => ({ ...item })),
    });
    sendServerMessage(client, {
      type: "host.snapshot",
      protocolVersion,
      status,
      ...store.projection(),
    });
  }

  function sendProtocolUpdateRequired(
    client: WebSocket,
    hostId: string,
    reason: ProtocolUpdateReason,
  ): void {
    sendServerMessage(client, {
      type: "protocol.update-required",
      reason,
      hostId,
    });
  }

  function synchronize(client: WebSocket, request: ScopeSetMessage): void {
    sessionScopesByClient.set(client, new Set(request.sessionIds));
    const projection = store.projection();
    const status = store.status(RELEASE_ID, warnings);
    const sessionsById = new Map(
      projection.sessions.map(session => [session.sessionId, session]),
    );
    const basis = request.cursor ? store.cursorBasis(request.cursor) : undefined;
    const protocolCompatible = request.protocolVersion === protocolVersion;
    const revisionCompatible = Object.entries(
      request.resourceRevisions ?? {},
    ).every(
      ([sessionId, expected]) =>
        sessionId === "timeline" || sessionId.startsWith("timeline:") ||
        sessionsById.get(sessionId)?.metadataRevision === expected,
    );

    if (basis?.compatible && protocolCompatible && revisionCompatible) {
      for (const item of store.changesAfter(basis.sequence)) {
        const message: ServerMessage = {
          type: "host.change-set",
          cursor: item.cursor,
          changes: [item.change],
        };
        sendServerMessage(client, message);
      }

      sendServerMessage(client, {
        type: "scope.current",
        scope: { kind: "host" },
        cursor: status.synchronization.cursor,
      });
    } else {
      let reason: ScopeResetReason;
      if (!protocolCompatible) {
        reason = "protocol-mismatch";
      } else if (!revisionCompatible) {
        reason = "revision-mismatch";
      } else if (basis && !basis.compatible) {
        reason = basis.reason;
      } else {
        reason = "new-scope";
      }

      sendServerMessage(client, {
        type: "scope.reset",
        reason,
        barrier: {
          scope: { kind: "host" },
          cursor: status.synchronization.cursor,
          resourceRevisions: Object.fromEntries(
            projection.sessions.map(session => [
              session.sessionId,
              session.metadataRevision,
            ]),
          ),
          protocolBasis: protocolVersion,
          capabilities: ["session.create", "session.rename", "scope.session"],
        },
        snapshot: projection,
      });
    }

    for (const sessionId of request.sessionIds) {
      const session = sessionsById.get(sessionId);
      if (!session) {
        continue;
      }

      const observedTimeline = request.resourceRevisions?.[`timeline:${sessionId}`]
        ?? (request.sessionIds.length === 1 ? request.resourceRevisions?.timeline : undefined);
      if (observedTimeline === session.timelineRevision && protocolCompatible && basis?.compatible) {
        sendServerMessage(client, {
          type: "scope.current",
          scope: { kind: "session", sessionId },
          cursor: status.synchronization.cursor,
        });
        continue;
      }
      sendServerMessage(client, {
        type: "scope.reset",
        reason: observedTimeline === undefined ? "new-scope" : "revision-mismatch",
        barrier: {
          scope: { kind: "session", sessionId },
          cursor: status.synchronization.cursor,
          resourceRevisions: {
            metadata: session.metadataRevision,
            timeline: session.timelineRevision,
          },
          protocolBasis: protocolVersion,
          capabilities: ["session.rename"],
        },
        snapshot: { session, timeline: store.timeline(sessionId) },
      });
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
      sendServerMessage(client, outcome);

      const changeSet: ServerMessage = {
        type: "host.change-set",
        cursor: created.cursor,
        changes: [{ type: "session.created", session: created.session }],
      };
      for (const socket of admittedClients) {
        sendServerMessage(socket, changeSet);
      }
    } catch (error) {
      const outcome: ServerMessage = {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: error instanceof Error ? error.message : "invalid-scope",
      };
      sendServerMessage(client, outcome);
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
        sendServerMessage(client, conflict);
        return;
      }

      const resolved = result.kind === "replayed" ? result.outcome : result;
      sendServerMessage(
        client,
        renameOutcomeMessage(command.commandId, resolved),
      );

      if (resolved.kind === "accepted" && result.kind !== "replayed") {
        const changeSet: ServerMessage = {
          type: "host.change-set",
          cursor: resolved.cursor,
          changes: [
            { type: "session.renamed", session: resolved.session },
          ],
        };
        for (const socket of admittedClients) {
          sendServerMessage(socket, changeSet);
        }
      }
    } catch {
      const failure: ServerMessage = {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: "commit-failed",
      };
      sendServerMessage(client, failure);
    }
  }

  function handleRunSubmit(client: WebSocket, command: RunSubmitMessage): void {
    const deviceId = clientDeviceIds.get(client);
    if (!deviceId) {
      return;
    }

    const admittedBasis = admittedCapabilityBasisByClient.get(client);
    if (!supportsCapabilityBasis(admittedBasis, command.requiredCapabilityBasis)) {
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: "required-capability-basis-unavailable",
      });
      return;
    }

    try {
      adapters.storage.beforeCommit();
      const result = store.submitRun(deviceId, command, adapters.clock.now());
      if (result.kind === "command-id-conflict") {
        sendServerMessage(client, {
          type: "command.outcome",
          commandId: command.commandId,
          outcome: "rejected",
          error: "command-id-conflict",
        });
        return;
      }

      const outcome = result.kind === "replayed" ? result.outcome : result;
      sendServerMessage(client, runOutcomeMessage(command.commandId, outcome));

      if (outcome.kind === "accepted" && result.kind !== "replayed") {
        const promptEntry = store.timeline(command.sessionId).at(-1);
        const session = store.projection().sessions.find(item => item.sessionId === command.sessionId);
        if (promptEntry && session) {
          publishTimelineChange(command.sessionId, {
            baseRevision: session.timelineRevision - 1,
            revision: session.timelineRevision,
            entry: promptEntry,
          });
        }
        const worker =
          workers.get(command.sessionId) ??
          new PiSessionWorker(command.sessionId, adapters.pi);
        workers.set(command.sessionId, worker);
        dispatchAcceptedRun(worker, command.sessionId, outcome.run.runId, command.prompt);
      }
    } catch {
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: "commit-failed",
      });
    }
  }

  function dispatchAcceptedRun(
    worker: PiSessionWorker,
    sessionId: string,
    runId: string,
    prompt: string,
  ): void {
    void worker
      .execute(prompt, event => {
        const change = store.applyTimelineEvent(
          sessionId,
          runId,
          event,
          adapters.clock.now(),
        );
        publishTimelineChange(sessionId, change);
      })
      .then(executionResult => {
        const finalAssistant = store.finalizeAssistant(sessionId, runId);
        if (finalAssistant) publishTimelineChange(sessionId, finalAssistant);
        const completed = store.completeRun(
          runId,
          executionResult.text,
          executionResult.checkpoint,
          adapters.clock.now(),
        );
        const message: ServerMessage = {
          type: "run.completed",
          ...completed,
        };
        for (const socket of admittedClients) {
          sendServerMessage(socket, message);
        }
      })
      .catch(error => {
        try {
          const errorDetail =
            error instanceof Error ? error.message : "runtime-error";
          const failed = store.settleRun(
            runId,
            "failed",
            `Pi execution failed: ${errorDetail}`,
            null,
            adapters.clock.now(),
          );
          for (const socket of admittedClients) {
            sendServerMessage(socket, { type: "run.completed", ...failed });
          }
        } catch {
          // Host loss is reconciled as Interrupted from the accepted durable row.
        }
      });
  }

  function publishTimelineChange(
    sessionId: string,
    change: { baseRevision: number; revision: number; entry: import("../../protocol/src/status.js").TimelineEntry },
  ): void {
    const message: ServerMessage = { type: "timeline.change", sessionId, ...change };
    for (const socket of admittedClients) {
      if (sessionScopesByClient.get(socket)?.has(sessionId)) {
        sendServerMessage(socket, message);
      }
    }
  }

  return {
    origin: canonicalOrigin,
    createPairing: () => pairing.create(canonicalOrigin),
    status: () => store.status(RELEASE_ID, warnings),
    revokeDevice,
    rotateSynchronizationEpoch: () =>
      store.rotateSynchronizationEpoch(adapters.clock.now()),
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
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  const hasValidSessionIds =
    Array.isArray(item.sessionIds) &&
    item.sessionIds.every(sessionId => typeof sessionId === "string");
  const hasValidCursor =
    item.cursor === undefined || typeof item.cursor === "string";
  const hasValidResourceRevisions =
    item.resourceRevisions === undefined ||
    isNumericRecord(item.resourceRevisions);

  return (
    item.type === "scope.set" &&
    typeof item.protocolVersion === "string" &&
    hasValidSessionIds &&
    hasValidCursor &&
    hasValidResourceRevisions
  );
}

function isNumericRecord(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(item => typeof item === "number")
  );
}

/** Only latest-value projection changes explicitly declared here may collapse. */
function replaceableChangeKey(message: ServerMessage): string | undefined {
  if (message.type !== "host.change-set" || message.changes.length !== 1) {
    return undefined;
  }

  const change = message.changes[0];
  if (change?.type !== "session.renamed") {
    return undefined;
  }

  return `session.renamed:${change.session.sessionId}`;
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

function isRunSubmitMessage(value: unknown): value is RunSubmitMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    item.type === "run.submit" &&
    typeof item.commandId === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.prompt === "string" &&
    item.prompt.trim().length > 0 &&
    item.prompt.length <= MAX_RUN_PROMPT_LENGTH &&
    item.requiredCapability === "run.submit" &&
    (item.requiredCapabilityBasis === undefined ||
      (Array.isArray(item.requiredCapabilityBasis) &&
        item.requiredCapabilityBasis.every(isCapabilityBasisRequirement)))
  );
}

function isCapabilityBasisRequirement(
  value: unknown,
): value is CapabilityBasisRequirement {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && Number.isSafeInteger(item.version);
}

function capabilityBasisKey(requirement: CapabilityBasisRequirement): string {
  return `${requirement.id}@${requirement.version}`;
}

function supportsCapabilityBasis(
  admittedBasis: ReadonlySet<string> | undefined,
  requiredBasis: readonly CapabilityBasisRequirement[] = [],
): boolean {
  return requiredBasis.every(
    requirement => admittedBasis?.has(capabilityBasisKey(requirement)) === true,
  );
}

function runOutcomeMessage(
  commandId: string,
  outcome: SubmitOutcome,
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
      runId: outcome.run.runId,
      receipt,
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
