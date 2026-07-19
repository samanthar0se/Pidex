import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  adaptersFor,
  executePidexFirewallOperation,
  type HostAdapters,
  type PiPresentationEffect,
  type PiInteractionRequest,
  type PiInteractionResult,
  type SessionJob,
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
  type RunRecord,
  type Interaction,
  type ServerMessage,
  type TerminalRun,
  type TimelineChange,
} from "../../protocol/src/status.js";
import { ensureCertificate } from "./certificate.js";
import {
  PairingAuthority,
  PairingError,
  type PairingInstructions,
} from "./pairing.js";
import {
  PiSessionWorker,
  WorkerLossError,
  WORKER_PROTOCOL_GENERATION,
} from "./pi-worker.js";
import { AuthorityGenerationStore } from "./authority-generation.js";
import {
  AuthorityStore,
  type InitialCatalog,
  type RenameOutcome,
  type SubmitCommand,
  type SubmitOutcome,
  type SteerCommand,
  type StopCommand,
} from "./store.js";

const DEFAULT_PORT = 7443;
const DEFAULT_HOSTNAME = "localhost";
const DEFAULT_LABEL = "Pidex Host";
const RELEASE_ID = "pidex@0.1.0";
const MAX_SESSION_NAME_LENGTH = 200;
const MAX_RUN_PROMPT_LENGTH = 100_000;
const MAX_INTERACTION_RESPONSE_BYTES = 100_000;
const DEFAULT_MAX_OUTBOUND_BYTES = 256 * 1024;
const DEFAULT_TIMELINE_PAGE_SIZE = 100;
const DEFAULT_COOPERATIVE_STOP_TIMEOUT_MS = 10_000;
const DEFAULT_FORCED_RECONCILIATION_TIMEOUT_MS = 5_000;
const COOPERATIVE_CANCELLATION_DETAIL =
  "Cancelled cooperatively. Partial output and committed side effects were not rolled back.";
const FORCED_CANCELLATION_DETAIL =
  "Cancelled by force-stopping the contained Session process tree. Recoverable partial output was retained; committed side effects may remain and were not rolled back.";
const TIMELINE_API_PATH = /^\/api\/sessions\/([^/]+)\/timeline$/;
const BLOB_API_PATH =
  /^\/api\/blobs\/(?:sha256%3A|sha256:)([a-f0-9]{64})$/;
const REQUIRED_CLIENT_CAPABILITIES = ["scope.host", "session.create"];
const PRESENTATION_EFFECTS_CAPABILITY = "presentation.effects@1";
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

interface SessionForkMessage {
  type: "session.fork";
  commandId: string;
  parentSessionId: string;
  forkPointEntryId: string;
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

interface SessionSleepMessage {
  type: "session.sleep";
  commandId: string;
  sessionId: string;
}
interface SessionAvailabilityMessage {
  type: "session.archive" | "session.restore";
  commandId: string;
  sessionId: string;
  observedMetadataRevision: number;
}

interface CapabilityBasisRequirement {
  id: string;
  version: number;
}

interface ViewIdentity {
  viewId: string;
  draftRevision: number;
}

interface RunSubmitMessage extends SubmitCommand {
  type: "run.submit" | "run.follow-up";
  requiredCapabilityBasis?: CapabilityBasisRequirement[];
  invokingView?: ViewIdentity;
}

interface ViewObserveMessage extends ViewIdentity {
  type: "view.observe";
  sessionId: string;
}

interface ScopeSetMessage {
  type: "scope.set";
  sessionIds: string[];
  cursor?: string;
  resourceRevisions?: Record<string, number>;
  protocolVersion: string;
}

interface RunQueueActionMessage {
  type: "run.release" | "run.cancel";
  commandId: string;
  runId: string;
}

interface RunSteerMessage extends SteerCommand {
  type: "run.steer";
  requiredCapability: "run.steer";
}

interface RunStopMessage extends StopCommand {
  type: "run.stop";
  requiredCapability: "run.stop";
}

interface RunPresentationContext {
  client: WebSocket;
  invokingView?: ViewIdentity;
}

interface InteractionResolveMessage {
  type: "interaction.resolve";
  commandId: string;
  interactionId: string;
  workerGeneration: number;
  observedRevision: number;
  dismiss?: boolean;
  value?: unknown;
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
  /** Time allowed for cooperative cancellation before force-stopping a run. */
  cooperativeStopTimeoutMs?: number;
  /** Time allowed for worker reconciliation after a run is force-stopped. */
  forcedReconciliationTimeoutMs?: number;
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
  const store = new AuthorityGenerationStore(
    options.dataDir,
    RELEASE_ID.replace("pidex@", ""),
    adapters,
  ).openBridge(options.initialCatalog);
  // An executing tail surviving daemon loss has no proof of normal completion.
  // Settle it conservatively and never dispatch it again to discover the result.
  store.reconcileAcceptedRuns(adapters.clock.now());
  store.resetResidencyOnStartup();
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

      if (request.url?.startsWith("/api/")) {
        handleApiRequest(
          request.url,
          request,
          response,
          store,
          options.authorization,
          pairing,
        );
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
  const scopedSessionIdsByClient = new Map<WebSocket, Set<string>>();
  const maxOutboundBytes =
    options.maxOutboundBytes ?? DEFAULT_MAX_OUTBOUND_BYTES;
  const cooperativeStopTimeoutMs =
    options.cooperativeStopTimeoutMs ?? DEFAULT_COOPERATIVE_STOP_TIMEOUT_MS;
  const forcedReconciliationTimeoutMs =
    options.forcedReconciliationTimeoutMs ??
    DEFAULT_FORCED_RECONCILIATION_TIMEOUT_MS;
  const deliveries = new Map<WebSocket, ClientDelivery>();
  const workers = new Map<string, PiSessionWorker>();
  const sessionJobs = new Map<string, SessionJob>();
  const forcedStopTimers = new Map<string, NodeJS.Timeout>();
  const forceEnforcedRunIds = new Set<string>();
  const workerGenerations = new Map<string, string>();
  const viewsByClient = new Map<WebSocket, Map<string, ViewIdentity>>();
  const presentationContextByRun = new Map<string, RunPresentationContext>();
  const interactionResolvers = new Map<
    string,
    (result: PiInteractionResult) => void
  >();
  const interactionDeadlineTimers = new Map<string, NodeJS.Timeout>();

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
      scopedSessionIdsByClient.delete(webSocket);
      deliveries.delete(webSocket);
      viewsByClient.delete(webSocket);
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
        } else if (isSessionForkMessage(message)) {
          void handleSessionFork(webSocket, message);
        } else if (isSessionRenameMessage(message)) {
          handleSessionRename(webSocket, message);
        } else if (isSessionSleepMessage(message)) {
          void handleSessionSleep(webSocket, message);
        } else if (isSessionAvailabilityMessage(message)) {
          handleSessionAvailability(webSocket, message);
        } else if (isRunSubmitMessage(message)) {
          handleRunSubmit(webSocket, message);
        } else if (isRunSteerMessage(message)) {
          handleRunSteer(webSocket, message);
        } else if (isRunStopMessage(message)) {
          handleRunStop(webSocket, message);
        } else if (isViewObserveMessage(message)) {
          observeView(webSocket, message);
        } else if (isRunQueueActionMessage(message)) {
          handleRunQueueAction(webSocket, message);
        } else if (isScopeSetMessage(message)) {
          synchronize(webSocket, message);
        } else if (isInteractionResolveMessage(message)) {
          handleInteractionResolve(webSocket, message);
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
    scopedSessionIdsByClient.set(client, new Set(request.sessionIds));
    const projection = store.projection();
    const status = store.status(RELEASE_ID, warnings);
    const allSessions = [
      ...projection.sessions,
      ...projection.archivedSessions,
    ];
    const sessionsById = new Map(
      allSessions.map(session => [session.sessionId, session]),
    );
    const basis = request.cursor ? store.cursorBasis(request.cursor) : undefined;
    const protocolCompatible = request.protocolVersion === protocolVersion;
    const revisionCompatible = Object.entries(
      request.resourceRevisions ?? {},
    ).every(
      ([sessionId, expected]) =>
        sessionId === "timeline" ||
        sessionId.startsWith("timeline:") ||
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
            allSessions.map(session => [
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

      const observedTimelineRevision = findObservedTimelineRevision(
        request,
        sessionId,
      );
      if (
        observedTimelineRevision === session.timelineRevision &&
        protocolCompatible &&
        basis?.compatible
      ) {
        sendServerMessage(client, {
          type: "scope.current",
          scope: { kind: "session", sessionId },
          cursor: status.synchronization.cursor,
        });
        continue;
      }
      sendServerMessage(client, {
        type: "scope.reset",
        reason:
          observedTimelineRevision === undefined
            ? "new-scope"
            : "revision-mismatch",
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
        snapshot: {
          session,
          timelineWindow: store.timelineWindow(sessionId),
          runs: store.runs(sessionId),
          interactions: store.interactions(sessionId),
        },
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

  async function handleSessionFork(
    client: WebSocket,
    command: SessionForkMessage,
  ): Promise<void> {
    try {
      const checkpoint = store.checkpointAt(
        command.parentSessionId,
        command.forkPointEntryId,
      );
      if (!checkpoint || !adapters.pi.forkCheckpoint) {
        throw new Error("invalid-fork-point");
      }

      const childSessionId = `session_${randomUUID()}`;
      const validatedCheckpoint = await adapters.pi.forkCheckpoint(
        command.parentSessionId,
        checkpoint,
        childSessionId,
      );
      adapters.storage.beforeCommit();
      const created = store.forkSession(
        command.parentSessionId,
        command.forkPointEntryId,
        command.projectId,
        command.workspaceId,
        childSessionId,
        validatedCheckpoint,
        adapters.clock.now(),
      );
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "accepted",
      });

      const changeSet: ServerMessage = {
        type: "host.change-set",
        cursor: created.cursor,
        changes: [{ type: "session.forked", session: created.session }],
      };
      for (const socket of admittedClients) {
        sendServerMessage(socket, changeSet);
      }
    } catch (error) {
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: error instanceof Error ? error.message : "fork-failed",
      });
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

  async function handleSessionSleep(
    client: WebSocket,
    command: SessionSleepMessage,
  ): Promise<void> {
    try {
      // Flush before the transactional quiescence recheck. Work accepted while
      // this await is pending therefore makes the final transition reject.
      const checkpoint = store.latestCheckpoint(command.sessionId);
      if (checkpoint) {
        const durableCheckpoint = await adapters.pi.flushCheckpoint?.(
          command.sessionId,
          checkpoint,
        );
        if (durableCheckpoint !== checkpoint) {
          throw new Error("checkpoint-flush-failed");
        }
      }

      adapters.storage.beforeCommit();
      const result = store.setSessionSleeping(
        command.sessionId,
        adapters.clock.now(),
      );
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "accepted",
      });

      closeSessionWorker(command.sessionId);

      const changeSet: ServerMessage = {
        type: "host.change-set",
        cursor: result.cursor,
        changes: [
          { type: "session.residency-changed", session: result.session },
        ],
      };
      for (const socket of admittedClients) {
        sendServerMessage(socket, changeSet);
      }
    } catch (error) {
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: error instanceof Error ? error.message : "sleep-failed",
      });
    }
  }

  function handleSessionAvailability(
    client: WebSocket,
    command: SessionAvailabilityMessage,
  ): void {
    const deviceId = clientDeviceIds.get(client);
    if (!deviceId) {
      return;
    }

    try {
      adapters.storage.beforeCommit();
      const availability = command.type === "session.archive"
        ? "archived"
        : "available";
      const result = store.changeSessionAvailability(
        deviceId,
        command,
        availability,
        adapters.clock.now(),
      );
      const error = "error" in result ? result.error : undefined;
      const accepted = result.kind === "accepted" ||
        (result.kind === "replayed" && !error);
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: accepted ? "accepted" : "rejected",
        ...(error ? { error } : {}),
      });

      if (result.kind === "accepted") {
        if (command.type === "session.archive") {
          closeSessionWorker(command.sessionId);
        }
        const changeType = command.type === "session.archive"
          ? "session.archived"
          : "session.restored";
        const changeSet: ServerMessage = {
          type: "host.change-set",
          cursor: result.cursor,
          changes: [{ type: changeType, session: result.session }],
        };
        for (const socket of admittedClients) {
          sendServerMessage(socket, changeSet);
        }
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

  function closeSessionWorker(sessionId: string): void {
    sessionJobs.get(sessionId)?.close();
    sessionJobs.delete(sessionId);
    workers.delete(sessionId);
    workerGenerations.delete(sessionId);
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
      if (command.invokingView) {
        observeView(client, {
          type: "view.observe",
          sessionId: command.sessionId,
          ...command.invokingView,
        });
      }
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
        const session = store
          .projection()
          .sessions.find(item => item.sessionId === command.sessionId);
        if (promptEntry && session) {
          publishTimelineChange(command.sessionId, {
            baseRevision: session.timelineRevision - 1,
            revision: session.timelineRevision,
            entry: promptEntry,
          });
        }
        presentationContextByRun.set(outcome.run.runId, {
          client,
          invokingView: command.invokingView,
        });
        if (outcome.run.state === "executing") {
          dispatchRun(outcome.run);
        }
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

  function handleRunQueueAction(
    client: WebSocket,
    command: RunQueueActionMessage,
  ): void {
    try {
      adapters.storage.beforeCommit();
      let run: RunRecord;
      if (command.type === "run.release") {
        run = store.releaseRun(command.runId);
        if (!presentationContextByRun.has(run.runId)) {
          presentationContextByRun.set(run.runId, { client });
        }
      } else {
        run = store.cancelQueuedRun(command.runId, adapters.clock.now());
        presentationContextByRun.delete(run.runId);
      }

      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "accepted",
        runId: run.runId,
      });
      if (run.state === "executing") {
        dispatchRun(run);
      }
    } catch (error) {
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error:
          error instanceof Error ? error.message : "queue-action-failed",
      });
    }
  }

  function handleRunSteer(client: WebSocket, command: RunSteerMessage): void {
    const deviceId = clientDeviceIds.get(client);
    if (!deviceId) {
      return;
    }

    try {
      const result = store.acceptSteering(
        deviceId,
        command,
        workerGenerations.get(command.sessionId),
        adapters.clock.now(),
      );
      if (result.kind === "rejected") {
        sendServerMessage(client, {
          type: "command.outcome",
          commandId: command.commandId,
          outcome: "rejected",
          error: result.error,
          reconciliationCursor: result.cursor,
          runId: command.runId,
        });
        return;
      }

      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "accepted",
        reconciliationCursor: result.cursor,
        runId: command.runId,
      });

      if (result.kind === "accepted") {
        publishTimelineChange(command.sessionId, {
          baseRevision: command.observedTimelineRevision,
          revision: command.observedTimelineRevision + 1,
          entry: result.entry,
        });
        const worker = workers.get(command.sessionId);
        void worker?.steer(command.text).then(
          () => store.markSteering(command.commandId, deviceId, true),
          () => store.markSteering(command.commandId, deviceId, false),
        );
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

  function handleRunStop(client: WebSocket, command: RunStopMessage): void {
    const deviceId = clientDeviceIds.get(client);
    if (!deviceId) {
      return;
    }

    try {
      adapters.storage.beforeCommit();
      const result = store.acceptStop(
        deviceId,
        command,
        workerGenerations.get(command.sessionId),
        adapters.clock.now(),
      );
      if (result.kind === "rejected") {
        sendServerMessage(client, {
          type: "command.outcome",
          commandId: command.commandId,
          outcome: "rejected",
          error: result.error,
          reconciliationCursor: result.cursor,
          runId: command.runId,
        });
        return;
      }

      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "accepted",
        reconciliationCursor: result.cursor,
        runId: command.runId,
      });
      if (result.kind === "replayed") {
        return;
      }

      const nextTimelineRevision = command.observedTimelineRevision + 1;
      publishTimelineChange(command.sessionId, {
        baseRevision: command.observedTimelineRevision,
        revision: nextTimelineRevision,
        entry: result.entry,
      });
      publishRunExecution(
        command.sessionId,
        command.runId,
        "cancelling",
        command.workerGeneration,
        nextTimelineRevision,
      );
      for (const interaction of result.withdrawn) {
        clearInteractionDeadline(interaction.interactionId);
        interactionResolvers
          .get(interaction.interactionId)
          ?.({ dismissed: true });
        interactionResolvers.delete(interaction.interactionId);
        publishInteraction(interaction);
      }
      store.markRunSteeringUnapplied(command.runId);
      try {
        workers.get(command.sessionId)?.stop();
      } catch {
        // Accepted intent still escalates when cooperative cancellation is
        // unavailable or the worker IPC has already stopped responding.
      }
      scheduleForcedStop(
        command.sessionId,
        command.runId,
        command.workerGeneration,
      );
    } catch (error) {
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error: error instanceof Error ? error.message : "stop-failed",
      });
    }
  }

  function clearForcedStopTimer(runId: string): void {
    const timer = forcedStopTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
    }
    forcedStopTimers.delete(runId);
  }

  function setForcedStopTimer(
    runId: string,
    callback: () => void,
    timeoutMs: number,
  ): void {
    clearForcedStopTimer(runId);
    forcedStopTimers.set(runId, setTimeout(callback, timeoutMs));
  }

  function scheduleForcedStop(
    sessionId: string,
    runId: string,
    workerGeneration: string,
  ): void {
    setForcedStopTimer(
      runId,
      () => enforceForcedStop(sessionId, runId, workerGeneration),
      cooperativeStopTimeoutMs,
    );
  }

  function enforceForcedStop(
    sessionId: string,
    runId: string,
    workerGeneration: string,
  ): void {
    const run = store.runs(sessionId).find(item => item.runId === runId);
    if (run?.state !== "cancelling") {
      clearForcedStopTimer(runId);
      return;
    }

    // A Job is per Session: closing it cannot affect daemon or siblings.
    forceEnforcedRunIds.add(runId);
    const sessionJob = sessionJobs.get(sessionId);
    sessionJob?.terminate();
    sessionJob?.close();
    sessionJobs.delete(sessionId);

    setForcedStopTimer(
      runId,
      () => reconcileForcedStop(sessionId, runId, workerGeneration),
      forcedReconciliationTimeoutMs,
    );
  }

  function reconcileForcedStop(
    sessionId: string,
    runId: string,
    workerGeneration: string,
  ): void {
    const run = store.runs(sessionId).find(item => item.runId === runId);
    if (run?.state !== "cancelling") {
      clearForcedStopTimer(runId);
      return;
    }

    const cancelled = store.settleRun(
      runId,
      "cancelled",
      FORCED_CANCELLATION_DETAIL,
      null,
      adapters.clock.now(),
    );
    forceEnforcedRunIds.delete(runId);
    presentationContextByRun.delete(runId);
    invalidateWorkerGeneration(sessionId, workerGeneration);
    publishRunCompletion(sessionId, cancelled.run);
    clearForcedStopTimer(runId);
  }

  function dispatchRun(run: RunRecord): void {
    if (!sessionJobs.has(run.sessionId)) {
      try {
        // This operation is the suspended-create/assign/resume boundary. A
        // failure must happen before any Pi, shell, tool, or extension runs.
        sessionJobs.set(
          run.sessionId,
          adapters.windows.createContainedSessionWorker(run.sessionId),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown";
        const failed = store.settleRun(
          run.runId,
          "failed",
          `session-containment-setup-failed: ${detail}`,
          null,
          adapters.clock.now(),
        );
        presentationContextByRun.delete(run.runId);
        publishRunCompletion(run.sessionId, failed.run);
        store.holdQueued(run.sessionId);
        return;
      }
    }
    const worker =
      workers.get(run.sessionId) ??
      new PiSessionWorker(run.sessionId, adapters.pi);
    workers.set(run.sessionId, worker);
    const workerGeneration =
      workerGenerations.get(run.sessionId) ?? randomUUID();
    workerGenerations.set(run.sessionId, workerGeneration);
    const timelineRevision = store.projection().sessions.find(
      item => item.sessionId === run.sessionId,
    )?.timelineRevision;
    if (timelineRevision !== undefined) {
      publishRunExecution(
        run.sessionId,
        run.runId,
        "executing",
        workerGeneration,
        timelineRevision,
      );
    }
    const presentationContext = presentationContextByRun.get(run.runId);
    void worker
      .execute(
        run.prompt,
        event => {
          const change = store.applyTimelineEvent(
            run.sessionId,
            run.runId,
            event,
            adapters.clock.now(),
          );
          publishTimelineChange(run.sessionId, change);
        },
        effect =>
          publishPresentationEffect(
            run.sessionId,
            workerGeneration,
            effect,
            presentationContext,
          ),
        request =>
          waitForInteractionResolution(run.sessionId, run.runId, request),
      )
      .then(executionResult => {
        clearForcedStopTimer(run.runId);
        const finalAssistant = store.finalizeAssistant(
          run.sessionId,
          run.runId,
        );
        if (finalAssistant) {
          publishTimelineChange(run.sessionId, finalAssistant);
        }
        const currentRun = store
          .runs(run.sessionId)
          .find(item => item.runId === run.runId);
        let completed;
        if (currentRun?.state === "cancelling") {
          completed = store.settleRun(
            run.runId,
            "cancelled",
            COOPERATIVE_CANCELLATION_DETAIL,
            executionResult.checkpoint,
            adapters.clock.now(),
          );
        } else {
          completed = store.completeRun(
            run.runId,
            executionResult.text,
            executionResult.checkpoint,
            adapters.clock.now(),
          );
        }
        forceEnforcedRunIds.delete(run.runId);
        presentationContextByRun.delete(run.runId);
        publishRunCompletion(run.sessionId, completed.run);
        const nextRun = store.dispatchNext(run.sessionId);
        if (nextRun) {
          dispatchRun(nextRun);
        }
      })
      .catch(error => {
        clearForcedStopTimer(run.runId);
        try {
          const currentRun = store
            .runs(run.sessionId)
            .find(item => item.runId === run.runId);
          if (currentRun?.state === "cancelling") {
            const cancelled = store.settleRun(
              run.runId,
              "cancelled",
              forceEnforcedRunIds.has(run.runId)
                ? FORCED_CANCELLATION_DETAIL
                : COOPERATIVE_CANCELLATION_DETAIL,
              null,
              adapters.clock.now(),
            );
            forceEnforcedRunIds.delete(run.runId);
            if (!sessionJobs.has(run.sessionId)) {
              invalidateWorkerGeneration(run.sessionId, workerGeneration);
            }
            presentationContextByRun.delete(run.runId);
            publishRunCompletion(run.sessionId, cancelled.run);
            return;
          }
          if (error instanceof WorkerLossError) {
            recoverFromWorkerLoss(run, workerGeneration, error);
            return;
          }

          invalidateWorkerGeneration(run.sessionId, workerGeneration);
          const errorDetail =
            error instanceof Error ? error.message : "runtime-error";
          const failed = store.settleRun(
            run.runId,
            "failed",
            `Pi execution failed: ${errorDetail}`,
            null,
            adapters.clock.now(),
          );
          presentationContextByRun.delete(run.runId);
          publishRunCompletion(run.sessionId, failed.run);
          store.holdQueued(run.sessionId);
        } catch {
          // Host loss is reconciled as Interrupted from the accepted durable row.
        }
      });
  }

  function recoverFromWorkerLoss(
    run: RunRecord,
    workerGeneration: string,
    error: WorkerLossError,
  ): void {
    invalidateWorkerGeneration(run.sessionId, workerGeneration);
    const finalAssistant = store.finalizeAssistant(run.sessionId, run.runId);
    if (finalAssistant) {
      publishTimelineChange(run.sessionId, finalAssistant);
    }

    const interrupted = store.settleRun(
      run.runId,
      "interrupted",
      `Worker recovery interrupted execution (${error.message}); normal settlement could not be proved. Partial output and committed side effects were preserved.`,
      null,
      adapters.clock.now(),
    );
    const sessionJob = sessionJobs.get(run.sessionId);
    sessionJob?.close();
    sessionJobs.delete(run.sessionId);

    const withdrawnInteractions = store.recoverWorkerLoss(
      run.sessionId,
      run.runId,
      adapters.clock.now(),
    );
    for (const interaction of withdrawnInteractions) {
      publishInteraction(interaction);
    }

    presentationContextByRun.delete(run.runId);
    publishRunCompletion(run.sessionId, interrupted.run);
  }

  function publishRunCompletion(sessionId: string, run: TerminalRun): void {
    const message: ServerMessage = {
      type: "run.completed",
      run,
      timeline: store.timelineWindow(sessionId).entries,
    };
    for (const socket of admittedClients) {
      sendServerMessage(socket, message);
    }
  }

  function publishPresentationEffect(
    sessionId: string,
    workerGeneration: string,
    effect: PiPresentationEffect,
    context: RunPresentationContext | undefined,
  ): void {
    if (workerGenerations.get(sessionId) !== workerGeneration) {
      return;
    }

    if (effect.type === "editor-text") {
      const invokingClient = context?.client;
      const invokingView = context?.invokingView;
      if (!invokingClient || !clientSupportsPresentationEffects(invokingClient)) {
        return;
      }

      const current = viewsByClient.get(invokingClient)?.get(sessionId);
      const matches = invokingView !== undefined &&
        current !== undefined &&
        current.viewId === invokingView.viewId &&
        current.draftRevision === invokingView.draftRevision;
      sendServerMessage(invokingClient, {
        type: "presentation.effect",
        sessionId,
        workerGeneration,
        effect: {
          ...effect,
          disposition: matches ? "inject" : "suggest",
          viewId: invokingView?.viewId,
          draftRevision: invokingView?.draftRevision,
        },
      });
      return;
    }

    for (const socket of admittedClients) {
      if (clientObservesPresentation(socket, sessionId)) {
        sendServerMessage(socket, {
          type: "presentation.effect",
          sessionId,
          workerGeneration,
          effect,
        });
      }
    }
  }

  function invalidateWorkerGeneration(
    sessionId: string,
    workerGeneration: string,
  ): void {
    if (workerGenerations.get(sessionId) !== workerGeneration) {
      return;
    }

    workerGenerations.delete(sessionId);
    workers.delete(sessionId);
    for (const interaction of store.interactions(sessionId)) {
      const resolver = interactionResolvers.get(interaction.interactionId);
      if (!resolver) {
        continue;
      }
      if (
        interaction.state !== "open" &&
        interaction.state !== "resolving"
      ) {
        continue;
      }
      interactionResolvers.delete(interaction.interactionId);
      clearInteractionDeadline(interaction.interactionId);
      const withdrawn = store.settleInteraction(
        interaction.interactionId,
        interaction.state,
        "withdrawn",
        "worker-lost",
        adapters.clock.now(),
        false,
      );
      if (withdrawn) {
        publishInteraction(withdrawn);
      }
      // Release the failed adapter invocation without replaying a submitted value.
      resolver({ dismissed: true });
    }
    for (const socket of admittedClients) {
      if (clientObservesPresentation(socket, sessionId)) {
        sendServerMessage(socket, {
          type: "presentation.reset",
          sessionId,
          workerGeneration,
        });
      }
    }
  }

  function clientObservesPresentation(
    client: WebSocket,
    sessionId: string,
  ): boolean {
    return (
      scopedSessionIdsByClient.get(client)?.has(sessionId) === true &&
      clientSupportsPresentationEffects(client)
    );
  }

  function clientSupportsPresentationEffects(client: WebSocket): boolean {
    return (
      admittedCapabilityBasisByClient
        .get(client)
        ?.has(PRESENTATION_EFFECTS_CAPABILITY) === true
    );
  }

  function observeView(client: WebSocket, message: ViewObserveMessage): void {
    let views = viewsByClient.get(client);
    if (!views) {
      views = new Map();
      viewsByClient.set(client, views);
    }
    views.set(message.sessionId, {
      viewId: message.viewId,
      draftRevision: message.draftRevision,
    });
  }

  function waitForInteractionResolution(
    sessionId: string,
    runId: string,
    request: PiInteractionRequest,
  ): Promise<PiInteractionResult> {
    return new Promise(resolve => {
      const created = store.createInteraction({
        sessionId,
        runId,
        workerGeneration: WORKER_PROTOCOL_GENERATION,
        correlationId: request.correlationId,
        kind: request.kind,
        payload: interactionPayload(request),
        ...(request.provenance ? { provenance: request.provenance } : {}),
        createdAt: adapters.clock.now(),
        deadlineAt: request.timeoutMs === undefined
          ? null
          : adapters.clock.now() + Math.max(0, request.timeoutMs),
      });
      interactionResolvers.set(created.interaction.interactionId, resolve);
      publishTimelineChange(sessionId, created.timelineChange);
      publishInteraction(created.interaction);
      scheduleInteractionDeadline(created.interaction);
    });
  }

  function scheduleInteractionDeadline(interaction: Interaction): void {
    if (interaction.deadlineAt === null) {
      return;
    }

    const delay = Math.max(0, interaction.deadlineAt - adapters.clock.now());
    const timer = setTimeout(
      () => expireInteraction(interaction.interactionId),
      delay,
    );
    interactionDeadlineTimers.set(interaction.interactionId, timer);
  }

  function clearInteractionDeadline(interactionId: string): void {
    const timer = interactionDeadlineTimers.get(interactionId);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    interactionDeadlineTimers.delete(interactionId);
  }

  function expireInteraction(interactionId: string): void {
    const interaction = store.loadInteraction(interactionId);
    if (
      interaction.deadlineAt === null ||
      adapters.clock.now() < interaction.deadlineAt
    ) {
      return;
    }
    const expired = store.settleInteraction(
      interactionId,
      "open",
      "expired",
      "deadline",
      interaction.deadlineAt,
      false,
    );
    if (!expired) {
      return;
    }
    clearInteractionDeadline(interactionId);
    publishInteraction(expired);
    const resolver = interactionResolvers.get(interactionId);
    interactionResolvers.delete(interactionId);
    resolver?.({ dismissed: true });
  }

  function publishTimelineChange(
    sessionId: string,
    change: TimelineChange,
  ): void {
    const message: ServerMessage = {
      type: "timeline.change",
      sessionId,
      ...change,
    };
    for (const socket of admittedClients) {
      if (scopedSessionIdsByClient.get(socket)?.has(sessionId)) {
        sendServerMessage(socket, message);
      }
    }
  }

  function publishRunExecution(
    sessionId: string,
    runId: string,
    state: "executing" | "cancelling",
    workerGeneration: string,
    timelineRevision: number,
  ): void {
    const message: ServerMessage = {
      type: "run.execution",
      sessionId,
      runId,
      state,
      workerGeneration,
      timelineRevision,
    };
    for (const socket of admittedClients) {
      if (scopedSessionIdsByClient.get(socket)?.has(sessionId)) {
        sendServerMessage(socket, message);
      }
    }
  }

  function publishInteraction(interaction: Interaction): void {
    for (const socket of admittedClients) {
      if (scopedSessionIdsByClient.get(socket)?.has(interaction.sessionId)) {
        sendServerMessage(socket, { type: "interaction.change", interaction });
      }
    }
  }

  function handleInteractionResolve(
    client: WebSocket,
    command: InteractionResolveMessage,
  ): void {
    const reject = (error: string): void => {
      sendServerMessage(client, {
        type: "command.outcome",
        commandId: command.commandId,
        outcome: "rejected",
        error,
      });
    };

    let interaction: Interaction;
    try {
      interaction = store.loadInteraction(command.interactionId);
    } catch {
      reject("unknown-interaction");
      return;
    }

    const isStale =
      interaction.state !== "open" ||
      interaction.revision !== command.observedRevision ||
      interaction.workerGeneration !== command.workerGeneration;
    if (isStale) {
      reject("stale-interaction");
      return;
    }

    if (
      interaction.deadlineAt !== null &&
      adapters.clock.now() >= interaction.deadlineAt
    ) {
      expireInteraction(interaction.interactionId);
      reject("stale-interaction");
      return;
    }

    let result: PiInteractionResult;
    if (command.dismiss) {
      result = { dismissed: true };
    } else if (isValidInteractionValue(interaction, command.value)) {
      result = { dismissed: false, value: command.value };
    } else {
      reject("invalid-interaction-value");
      return;
    }

    const resolver = interactionResolvers.get(interaction.interactionId);
    if (!resolver) {
      reject("exact-worker-unavailable");
      return;
    }

    const resolving = store.reserveInteraction(
      interaction.interactionId,
      command.observedRevision,
      clientDeviceIds.get(client) ?? "paired device",
    );
    if (!resolving) {
      reject("stale-interaction");
      return;
    }

    publishInteraction(resolving);
    sendServerMessage(client, {
      type: "command.outcome",
      commandId: command.commandId,
      outcome: "accepted",
    });
    resolver(result);
    interactionResolvers.delete(interaction.interactionId);
    clearInteractionDeadline(interaction.interactionId);
    // Resolving the exact in-process request is the worker acknowledgement;
    // only then may authority expose a terminal state.
    const terminalState = command.dismiss ? "dismissed" : "responded";
    const terminalCause = command.dismiss
      ? "device-dismissal"
      : "device-response";
    const terminal = store.settleInteraction(
      interaction.interactionId,
      "resolving",
      terminalState,
      terminalCause,
      adapters.clock.now(),
      true,
    );
    if (terminal) {
      publishInteraction(terminal);
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
      for (const timer of interactionDeadlineTimers.values()) {
        clearTimeout(timer);
      }
      interactionDeadlineTimers.clear();
      for (const runId of forcedStopTimers.keys()) {
        clearForcedStopTimer(runId);
      }
      for (const job of sessionJobs.values()) job.close();
      sessionJobs.clear();
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

function findObservedTimelineRevision(
  request: ScopeSetMessage,
  sessionId: string,
): number | undefined {
  const sessionRevision = request.resourceRevisions?.[`timeline:${sessionId}`];
  if (sessionRevision !== undefined) {
    return sessionRevision;
  }

  if (request.sessionIds.length === 1) {
    return request.resourceRevisions?.timeline;
  }
  return undefined;
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

function isSessionForkMessage(value: unknown): value is SessionForkMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  const hasValidProject =
    item.projectId === undefined ||
    item.projectId === null ||
    typeof item.projectId === "string";
  const hasValidWorkspace =
    item.workspaceId === undefined ||
    item.workspaceId === null ||
    typeof item.workspaceId === "string";

  return (
    item.type === "session.fork" &&
    typeof item.commandId === "string" &&
    typeof item.parentSessionId === "string" &&
    typeof item.forkPointEntryId === "string" &&
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
    (item.type === "run.submit" || item.type === "run.follow-up") &&
    typeof item.commandId === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.prompt === "string" &&
    item.prompt.trim().length > 0 &&
    item.prompt.length <= MAX_RUN_PROMPT_LENGTH &&
    item.requiredCapability === item.type &&
    (item.invokingView === undefined || isInvokingView(item.invokingView)) &&
    (item.requiredCapabilityBasis === undefined ||
      (Array.isArray(item.requiredCapabilityBasis) &&
        item.requiredCapabilityBasis.every(isCapabilityBasisRequirement)))
  );
}

function isInvokingView(value: unknown): value is ViewIdentity {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.viewId === "string" &&
    item.viewId.length > 0 &&
    item.viewId.length <= 200 &&
    Number.isSafeInteger(item.draftRevision) &&
    Number(item.draftRevision) >= 0
  );
}

function isViewObserveMessage(value: unknown): value is ViewObserveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    item.type === "view.observe" &&
    typeof item.sessionId === "string" &&
    isInvokingView(item)
  );
}

function isSessionSleepMessage(value: unknown): value is SessionSleepMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    item.type === "session.sleep" &&
    typeof item.commandId === "string" &&
    item.commandId.length > 0 &&
    typeof item.sessionId === "string"
  );
}

function isSessionAvailabilityMessage(
  value: unknown,
): value is SessionAvailabilityMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    (item.type === "session.archive" || item.type === "session.restore") &&
    typeof item.commandId === "string" &&
    typeof item.sessionId === "string" &&
    Number.isSafeInteger(item.observedMetadataRevision) &&
    Number(item.observedMetadataRevision) > 0
  );
}

function isRunQueueActionMessage(value: unknown): value is RunQueueActionMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    (item.type === "run.release" || item.type === "run.cancel") &&
    typeof item.commandId === "string" &&
    typeof item.runId === "string"
  );
}

function isRunSteerMessage(value: unknown): value is RunSteerMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    item.type === "run.steer" &&
    item.requiredCapability === "run.steer" &&
    typeof item.commandId === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.runId === "string" &&
    typeof item.workerGeneration === "string" &&
    Number.isSafeInteger(item.observedTimelineRevision) &&
    Number(item.observedTimelineRevision) > 0 &&
    typeof item.text === "string" &&
    item.text.trim().length > 0 &&
    item.text.length <= MAX_RUN_PROMPT_LENGTH
  );
}

function isRunStopMessage(value: unknown): value is RunStopMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    item.type === "run.stop" &&
    item.requiredCapability === "run.stop" &&
    typeof item.commandId === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.runId === "string" &&
    typeof item.workerGeneration === "string" &&
    item.observedState === "executing" &&
    Number.isSafeInteger(item.observedTimelineRevision) &&
    Number(item.observedTimelineRevision) > 0
  );
}

function isInteractionResolveMessage(
  value: unknown,
): value is InteractionResolveMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    item.type === "interaction.resolve" &&
    typeof item.commandId === "string" &&
    typeof item.interactionId === "string" &&
    Number.isSafeInteger(item.workerGeneration) &&
    Number.isSafeInteger(item.observedRevision) &&
    (item.dismiss === undefined || typeof item.dismiss === "boolean")
  );
}

function isValidInteractionValue(
  interaction: Interaction,
  value: unknown,
): value is string | boolean {
  switch (interaction.kind) {
    case "select":
      return (
        typeof value === "string" &&
        interaction.payload.options?.includes(value) === true
      );
    case "confirm":
      return typeof value === "boolean";
    case "input":
    case "editor":
      return (
        typeof value === "string" &&
        Buffer.byteLength(value) <= MAX_INTERACTION_RESPONSE_BYTES
      );
  }
}

function interactionPayload(
  request: PiInteractionRequest,
): Interaction["payload"] {
  const payload: Interaction["payload"] = { message: request.message };
  if (request.kind === "select") {
    payload.options = request.options;
  } else if (request.defaultValue !== undefined) {
    payload.defaultValue = request.defaultValue;
  }
  return payload;
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

function handleApiRequest(
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  store: AuthorityStore,
  expectedAuthorization: string | undefined,
  pairing: PairingAuthority,
): void {
  if (
    !hasValidAuthorization(
      request.headers.authorization,
      expectedAuthorization,
      pairing,
    )
  ) {
    response.writeHead(401, { "cache-control": "no-store" }).end();
    return;
  }

  const url = new URL(path, "https://pidex.invalid");
  const timelineMatch = TIMELINE_API_PATH.exec(url.pathname);
  if (request.method === "GET" && timelineMatch) {
    const cursor = url.searchParams.get("cursor");
    const requestedLimit = Number(
      url.searchParams.get("limit") ?? DEFAULT_TIMELINE_PAGE_SIZE,
    );
    let page = null;
    if (cursor && Number.isSafeInteger(requestedLimit)) {
      page = store.timelinePage(
        decodeURIComponent(timelineMatch[1]),
        cursor,
        requestedLimit,
      );
    }

    if (!page) {
      response
        .writeHead(409, {
          "cache-control": "no-store",
          "content-type": "application/json",
        })
        .end(JSON.stringify({ error: "invalid-or-expired-cursor" }));
      return;
    }

    response
      .writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json",
      })
      .end(JSON.stringify(page));
    return;
  }

  const blobMatch = BLOB_API_PATH.exec(url.pathname);
  if (request.method === "GET" && blobMatch) {
    const digest = blobMatch[1];
    const blobId = `sha256:${digest}`;
    try {
      const bytes = store.readReferencedBlob(blobId);
      if (!bytes) {
        response.writeHead(404, { "cache-control": "no-store" }).end();
        return;
      }

      response
        .writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/octet-stream",
          "content-length": bytes.length,
          "x-content-id": blobId,
          digest: `sha-256=${Buffer.from(digest, "hex").toString("base64")}`,
        })
        .end(bytes);
    } catch {
      response
        .writeHead(500, {
          "cache-control": "no-store",
          "content-type": "application/json",
        })
        .end(JSON.stringify({ error: "content-verification-failed", blobId }));
    }
    return;
  }

  response.writeHead(404, { "cache-control": "no-store" }).end();
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
