import type {
  ClientAdapters,
  CommandResult,
  DirectoryFact,
  DiscoveryProjection,
  InteractionFact,
  ProjectFact,
  RunFact,
  SessionCreateResult,
  SessionFact,
  SessionProjection,
  TimelineChange,
  WorkspaceFact,
} from "./client-store.js";
import { randomUuid } from "./client-identifier.js";
import { ControlConnection } from "./control-connection.js";

const capabilities = ["scope.host", "scope.session", "session.create", "directory.browse", "project.add-from-directory", "run.submit", "run.follow-up", "run.steer", "run.stop", "run.release", "run.cancel", "session.read-state", "session.archive", "session.restore", "pi.input.image", "pi.interaction.basic"];
const sockets = new Map<string, WebSocket>();
const listeners = new Map<string, Set<(change: TimelineChange) => void>>();
const runListeners = new Map<string, Set<(runs: RunFact[]) => void>>();
const runsBySession = new Map<string, RunFact[]>();
const interactionListeners = new Map<string, Set<(interactions: InteractionFact[]) => void>>();
const interactionsBySession = new Map<string, InteractionFact[]>();
const uncertainCommands = new Map<string, Record<string, unknown> & { commandId: string }>();
const controlConnection = new ControlConnection(
  () => new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/control`),
  capabilities,
);

function socketFor(onMessage: (message: any, socket: WebSocket, finish: <T>(value: T) => void) => void) {
  return new Promise<any>((resolve, reject) => {
    let unsubscribe = () => {};
    const timeout = window.setTimeout(() => fail(new Error("Host synchronization timed out")), 10_000);
    const finish = <T,>(value: T) => {
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(value);
    };
    const fail = (error: Error) => {
      window.clearTimeout(timeout);
      unsubscribe();
      reject(error);
    };
    unsubscribe = controlConnection.subscribe(
      (message, socket) => onMessage(message, socket, finish),
      () => fail(new Error("Host unavailable")),
    );
  });
}

function setScope(socket: WebSocket, sessionIds: string[]) {
  socket.send(JSON.stringify({ type: "scope.set", sessionIds, protocolVersion: "1.2", resourceRevisions: {} }));
}

async function readCatalog(): Promise<DiscoveryProjection> {
  return socketFor((message, socket, finish) => {
    if (message.type === "host.snapshot") setScope(socket, []);
    else if (message.type === "scope.reset" && message.barrier?.scope?.kind === "host") {
      finish({
        projects: message.snapshot.projects,
        workspaces: message.snapshot.workspaces,
        sessions: message.snapshot.sessions,
        archivedSessions: message.snapshot.archivedSessions,
        cursor: message.barrier.cursor,
      });
    }
  });
}

async function listProjectWorktrees(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/worktrees`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Worktree discovery unavailable (${response.status})`);
  }
  return await response.json();
}

function readSession(sessionId: string): Promise<SessionProjection> {
  return new Promise((resolve, reject) => {
    let synchronized = false;
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("Host synchronization timed out"));
    }, 10_000);
    const unsubscribe = controlConnection.subscribe((message, socket) => {
      if (message.type === "host.snapshot") {
        setScope(socket, [sessionId]);
      } else if (message.type === "scope.reset" && message.barrier?.scope?.kind === "session" && message.barrier.scope.sessionId === sessionId) {
        window.clearTimeout(timeout);
        synchronized = true;
        sockets.set(sessionId, socket);
        runsBySession.set(sessionId, message.snapshot.runs ?? []);
        interactionsBySession.set(sessionId, message.snapshot.interactions ?? []);
        resolve({
          session: message.snapshot.session,
          timeline: message.snapshot.timelineWindow.entries,
          olderCursor: message.snapshot.timelineWindow.olderCursor,
          runs: message.snapshot.runs ?? [],
          interactions: message.snapshot.interactions ?? [],
          cursor: message.barrier.cursor,
        });
      } else if (message.type === "timeline.change" && message.sessionId === sessionId) {
        listeners.get(sessionId)?.forEach(listener => listener(message));
      } else if (message.type === "run.execution" && message.sessionId === sessionId) {
        updateRun(sessionId, message.runId, { state: message.state, workerGeneration: message.workerGeneration });
      } else if (message.type === "run.completed" && message.run.sessionId === sessionId) {
        updateRun(sessionId, message.run.runId, message.run);
      } else if (message.type === "interaction.change" && message.interaction.sessionId === sessionId) {
        const current = interactionsBySession.get(sessionId) ?? [];
        const next = current.filter(item => item.interactionId !== message.interaction.interactionId);
        next.push(message.interaction);
        next.sort(compareInteractions);
        interactionsBySession.set(sessionId, next);
        interactionListeners.get(sessionId)?.forEach(listener => listener(next));
      }
    }, () => {
      sockets.delete(sessionId);
      if (!synchronized) {
        window.clearTimeout(timeout);
        unsubscribe();
        reject(new Error("Host unavailable"));
      }
    });
  });
}

async function restoreSession(session: SessionFact): Promise<void> {
  await socketFor((message, socket, finish) => {
    if (message.type === "host.snapshot") {
      socket.send(JSON.stringify({ type: "session.restore", commandId: randomUuid(), sessionId: session.sessionId, observedMetadataRevision: session.metadataRevision }));
    } else if (message.type === "host.change-set" && message.changes?.some((change: any) => change.type === "session.restored" && change.session.sessionId === session.sessionId)) finish(undefined);
    else if (message.type === "command.outcome" && message.outcome === "rejected") throw new Error(message.error ?? "Restore rejected");
  });
}

function connect(onReady: (socket: WebSocket) => void, onMessage: (message: any) => void, uncertain: () => void) {
  let sent = false;
  const unsubscribe = controlConnection.subscribe((message, socket) => {
    if (message.type === "host.snapshot" && !sent) {
      sent = true;
      onReady(socket);
      return;
    }
    onMessage(message);
  }, uncertain);
  const timeout = window.setTimeout(() => { unsubscribe(); uncertain(); }, 10_000);
  return () => { window.clearTimeout(timeout); unsubscribe(); };
}

function createSession(command: Parameters<NonNullable<ClientAdapters["host"]["createSession"]>>[0]): Promise<SessionCreateResult> {
  return new Promise(resolve => {
    let accepted = false; let session: SessionFact | undefined; let settled = false; let close = () => {};
    const finish = (result: SessionCreateResult) => { if (settled) return; settled = true; close(); resolve(result); };
    close = connect(socket => socket.send(JSON.stringify({ type: "session.create", ...command })), message => {
      if (message.type === "command.outcome" && message.commandId === command.commandId) {
        if (message.outcome === "rejected") finish({ kind: "rejected", reason: message.error ?? "creation-rejected" });
        else { accepted = true; if (session) finish({ kind: "accepted", session }); }
      }
      const created = message.type === "host.change-set" && message.changes?.find((change: any) => change.type === "session.created")?.session;
      if (created) { session = created; if (accepted) finish({ kind: "accepted", session }); }
    }, () => finish({ kind: "uncertain", reason: "transport-lost" }));
  });
}

function browseDirectories(parentToken?: string): Promise<DirectoryFact[]> {
  const requestId = randomUuid();
  return socketFor((message, socket, finish) => {
    if (message.type === "host.snapshot") {
      socket.send(JSON.stringify({
        type: "directory.browse",
        requestId,
        parentToken,
      }));
    } else if (
      message.type === "directory.browse-result" &&
      message.requestId === requestId
    ) {
      if (message.error) throw new Error(message.error);
      finish(message.entries);
    }
  });
}

function addProject(command: {
  commandId: string;
  selectionToken: string;
  projectName: string;
}) {
  return new Promise<
    CommandResult & { project?: ProjectFact; workspace?: WorkspaceFact }
  >(resolve => {
    let accepted = false;
    let created:
      | { project: ProjectFact; workspace: WorkspaceFact }
      | undefined;
    let settled = false;
    let close = () => {};
    const finish = (
      result: CommandResult & {
        project?: ProjectFact;
        workspace?: WorkspaceFact;
      },
    ) => {
      if (settled) return;
      settled = true;
      close();
      resolve(result);
    };
    close = connect(
      socket =>
        socket.send(
          JSON.stringify({
            type: "project.add-from-directory",
            ...command,
          }),
        ),
      message => {
        if (
          message.type === "command.outcome" &&
          message.commandId === command.commandId
        ) {
          if (message.outcome === "rejected") {
            finish({
              kind: "rejected",
              reason: message.error ?? "project-creation-rejected",
            });
          } else {
            accepted = true;
            if (created) finish({ kind: "accepted", ...created });
          }
        }
        const change =
          message.type === "host.change-set"
            ? message.changes?.find(
                (item: { type?: string }) => item.type === "project.created",
              )
            : undefined;
        if (change) {
          created = {
            project: change.project,
            workspace: change.workspace,
          };
          if (accepted) finish({ kind: "accepted", ...created });
        }
      },
      () => finish({ kind: "uncertain", reason: "transport-lost" }),
    );
  });
}

function submitRun(command: Parameters<NonNullable<ClientAdapters["host"]["submitRun"]>>[0]): Promise<CommandResult> {
  return sendRunCommand(
    {
      type: "run.submit",
      requiredCapability: "run.submit",
      ...command,
      ...(command.images?.length
        ? { requiredCapabilityBasis: [{ id: "pi.input.image", version: 1 }] }
        : {}),
    },
    "run-rejected",
  );
}

function sendRunCommand(
  message: Record<string, unknown> & { commandId: string },
  rejectionReason = "command-rejected",
): Promise<CommandResult> {
  return new Promise(resolve => {
    let settled = false; let close = () => {};
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (result.kind === "uncertain") uncertainCommands.set(message.commandId, message);
      else uncertainCommands.delete(message.commandId);
      close(); resolve(result);
    };
    close = connect(socket => socket.send(JSON.stringify(message)), incoming => {
      if (incoming.type !== "command.outcome" || incoming.commandId !== message.commandId) return;
      finish(incoming.outcome === "rejected" ? { kind: "rejected", reason: incoming.error ?? rejectionReason } : { kind: "accepted" });
    }, () => finish({ kind: "uncertain", reason: "transport-lost" }));
  });
}

function updateRun(sessionId: string, runId: string, change: Partial<RunFact>) {
  const runs = runsBySession.get(sessionId) ?? [];
  const next = runs.map(run => run.runId === runId ? { ...run, ...change } : run);
  runsBySession.set(sessionId, next);
  runListeners.get(sessionId)?.forEach(listener => listener(next));
}

export const hostSessionAdapter: ClientAdapters["host"] = {
  watchConnection(listener) {
    return controlConnection.subscribeStatus(listener);
  },
  watchDiscovery(listener) {
    return controlConnection.subscribe(message => {
      if (message.type !== "host.change-set") return;
      for (const change of message.changes ?? []) {
        if (change.type === "session.attention-changed") {
          listener({
            sessionId: change.sessionId,
            attention: change.attention,
            activity: change.activity,
            cursor: message.cursor,
          });
        } else if (change.type === "session.read-state-changed") {
          listener({ sessionId: change.sessionId, readState: change.readState });
        }
      }
    });
  },
  readCatalog,
  readSession,
  restoreSession,
  listProjectWorktrees,
  createSession,
  browseDirectories,
  addProject,
  submitRun,
  steerRun: command => sendRunCommand({
    type: "run.steer",
    requiredCapability: "run.steer",
    ...command,
    ...(command.images?.length
      ? { requiredCapabilityBasis: [{ id: "pi.input.image", version: 1 }] }
      : {}),
  }),
  stopRun: command => sendRunCommand({ type: "run.stop", requiredCapability: "run.stop", ...command }),
  actOnHeldRun: command => sendRunCommand({ type: `run.${command.action}`, commandId: command.commandId, runId: command.runId }),
  resolveInteraction: command => sendRunCommand(command),
  async reconcileCommand(commandId) {
    const original = uncertainCommands.get(commandId);
    if (!original) return { kind: "indeterminate", reason: "original-command-envelope-unavailable" };
    const result = await sendRunCommand(original);
    if (result.kind === "accepted" || result.kind === "rejected") return result;
    return { kind: "indeterminate", reason: result.reason };
  },
  watchSession(sessionId, listener) {
    const sessionListeners = listeners.get(sessionId) ?? new Set();
    sessionListeners.add(listener);
    listeners.set(sessionId, sessionListeners);
    return () => sessionListeners.delete(listener);
  },
  watchRuns(sessionId, listener) {
    const sessionListeners = runListeners.get(sessionId) ?? new Set();
    sessionListeners.add(listener);
    runListeners.set(sessionId, sessionListeners);
    return () => sessionListeners.delete(listener);
  },
  watchInteractions(sessionId, listener) {
    const sessionListeners = interactionListeners.get(sessionId) ?? new Set();
    sessionListeners.add(listener);
    interactionListeners.set(sessionId, sessionListeners);
    return () => sessionListeners.delete(listener);
  },
  async readOlder(sessionId, cursor) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/timeline?cursor=${encodeURIComponent(cursor)}&limit=100`);
    if (!response.ok) throw new Error(`Timeline history unavailable (${response.status})`);
    return await response.json();
  },
  async markRead(sessionId, timelineRevision) {
    const socket = sockets.get(sessionId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: "session.mark-read",
      commandId: randomUuid(),
      sessionId,
      presentedTimelineRevision: timelineRevision,
      requiredCapabilityBasis: [{ id: "session.read-state", version: 1 }],
    }));
  },
};

function compareInteractions(left: InteractionFact, right: InteractionFact) {
  if (left.deadlineAt === null && right.deadlineAt !== null) return 1;
  if (left.deadlineAt !== null && right.deadlineAt === null) return -1;
  return (left.deadlineAt ?? left.createdAt) - (right.deadlineAt ?? right.createdAt)
    || left.createdAt - right.createdAt || left.interactionId.localeCompare(right.interactionId);
}
