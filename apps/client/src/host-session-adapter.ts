import type { ClientAdapters, CommandResult, DiscoveryProjection, InteractionFact, RunFact, SessionCreateResult, SessionFact, SessionProjection, TimelineChange } from "./client-store.js";

const capabilities = ["scope.host", "scope.session", "session.create", "run.submit", "run.follow-up", "run.steer", "run.stop", "run.release", "run.cancel", "session.read-state", "session.archive", "session.restore", "pi.interaction.basic"];
const sockets = new Map<string, WebSocket>();
const listeners = new Map<string, Set<(change: TimelineChange) => void>>();
const runListeners = new Map<string, Set<(runs: RunFact[]) => void>>();
const runsBySession = new Map<string, RunFact[]>();
const interactionListeners = new Map<string, Set<(interactions: InteractionFact[]) => void>>();
const interactionsBySession = new Map<string, InteractionFact[]>();
const uncertainCommands = new Map<string, Record<string, unknown> & { commandId: string }>();

function socketFor(onMessage: (message: any, socket: WebSocket, finish: <T>(value: T) => void) => void) {
  return new Promise<any>((resolve, reject) => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/control`);
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("Host synchronization timed out")); }, 10_000);
    const finish = <T,>(value: T) => { window.clearTimeout(timeout); socket.close(); resolve(value); };
    socket.onerror = () => reject(new Error("Host unavailable"));
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "host.hello") socket.send(JSON.stringify({
        type: "client.hello", expectedHostId: message.hostId, protocols: [{ major: 1, minor: 2 }],
        capabilities: capabilities.map(id => ({ id, minVersion: 1, maxVersion: 1 })),
      }));
      else onMessage(message, socket, finish);
    };
  });
}

function setScope(socket: WebSocket, sessionIds: string[]) {
  socket.send(JSON.stringify({ type: "scope.set", sessionIds, protocolVersion: "1.2", resourceRevisions: {} }));
}

async function readCatalog(): Promise<DiscoveryProjection> {
  return socketFor((message, socket, finish) => {
    if (message.type === "host.snapshot") setScope(socket, []);
    else if (message.type === "scope.reset" && message.barrier?.scope?.kind === "host") {
      finish({ projects: message.snapshot.projects, sessions: message.snapshot.sessions, archivedSessions: message.snapshot.archivedSessions });
    }
  });
}

function readSession(sessionId: string): Promise<SessionProjection> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/control`);
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error("Host synchronization timed out"));
    }, 10_000);
    socket.onerror = () => reject(new Error("Host unavailable"));
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "host.hello") {
        socket.send(JSON.stringify({
          type: "client.hello", expectedHostId: message.hostId, protocols: [{ major: 1, minor: 2 }],
          capabilities: capabilities.map(id => ({ id, minVersion: 1, maxVersion: 1 })),
        }));
      } else if (message.type === "host.snapshot") {
        setScope(socket, [sessionId]);
      } else if (message.type === "scope.reset" && message.barrier?.scope?.kind === "session" && message.barrier.scope.sessionId === sessionId) {
        window.clearTimeout(timeout);
        sockets.set(sessionId, socket);
        runsBySession.set(sessionId, message.snapshot.runs ?? []);
        interactionsBySession.set(sessionId, message.snapshot.interactions ?? []);
        resolve({
          session: message.snapshot.session,
          timeline: message.snapshot.timelineWindow.entries,
          olderCursor: message.snapshot.timelineWindow.olderCursor,
          runs: message.snapshot.runs ?? [],
          interactions: message.snapshot.interactions ?? [],
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
    };
  });
}

async function restoreSession(session: SessionFact): Promise<void> {
  await socketFor((message, socket, finish) => {
    if (message.type === "host.snapshot") {
      socket.send(JSON.stringify({ type: "session.restore", commandId: crypto.randomUUID(), sessionId: session.sessionId, observedMetadataRevision: session.metadataRevision }));
    } else if (message.type === "host.change-set" && message.changes?.some((change: any) => change.type === "session.restored" && change.session.sessionId === session.sessionId)) finish(undefined);
    else if (message.type === "command.outcome" && message.outcome === "rejected") throw new Error(message.error ?? "Restore rejected");
  });
}

function openControlSocket(onMessage: (message: any) => void) {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/control`);
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.type === "host.hello") {
      socket.send(JSON.stringify({
        type: "client.hello", expectedHostId: message.hostId, protocols: [{ major: 1, minor: 2 }],
        capabilities: capabilities.map(id => ({ id, minVersion: 1, maxVersion: 1 })),
      }));
      return;
    }
    onMessage(message);
  };
  return socket;
}

function connect(onReady: (socket: WebSocket) => void, onMessage: (message: any) => void, uncertain: () => void) {
  let sent = false;
  const socket = openControlSocket(message => {
    if (message.type === "host.snapshot" && !sent) {
      sent = true;
      onReady(socket);
      return;
    }
    onMessage(message);
  });
  const timeout = window.setTimeout(() => { socket.close(); uncertain(); }, 10_000);
  socket.onerror = uncertain;
  socket.onclose = () => { if (sent) uncertain(); };
  return () => { window.clearTimeout(timeout); socket.onclose = null; socket.close(); };
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

function submitRun(command: Parameters<NonNullable<ClientAdapters["host"]["submitRun"]>>[0]): Promise<CommandResult> {
  return sendRunCommand(
    { type: "run.submit", requiredCapability: "run.submit", ...command },
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
  readCatalog,
  readSession,
  restoreSession,
  createSession,
  submitRun,
  steerRun: command => sendRunCommand({ type: "run.steer", requiredCapability: "run.steer", ...command }),
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
      commandId: crypto.randomUUID(),
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
