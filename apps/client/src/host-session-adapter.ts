import type { ClientAdapters, CommandResult, DiscoveryProjection, SessionCreateResult, SessionFact, SessionProjection } from "./client-store.js";

const capabilities = ["scope.host", "scope.session", "session.create", "run.submit", "session.read-state", "session.archive", "session.restore"];

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

async function readSession(sessionId: string): Promise<SessionProjection> {
  return socketFor((message, socket, finish) => {
    if (message.type === "host.snapshot") setScope(socket, [sessionId]);
    else if (message.type === "scope.reset" && message.barrier?.scope?.kind === "session" && message.barrier.scope.sessionId === sessionId) {
      finish({ session: message.snapshot.session, timeline: message.snapshot.timelineWindow.entries });
    }
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
  return new Promise(resolve => {
    let settled = false; let close = () => {};
    const finish = (result: CommandResult) => { if (settled) return; settled = true; close(); resolve(result); };
    close = connect(socket => socket.send(JSON.stringify({ type: "run.submit", requiredCapability: "run.submit", ...command })), message => {
      if (message.type !== "command.outcome" || message.commandId !== command.commandId) return;
      finish(message.outcome === "rejected" ? { kind: "rejected", reason: message.error ?? "run-rejected" } : { kind: "accepted" });
    }, () => finish({ kind: "uncertain", reason: "transport-lost" }));
  });
}

export const hostSessionAdapter: ClientAdapters["host"] = { readCatalog, readSession, restoreSession, createSession, submitRun };
