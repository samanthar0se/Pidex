import type { ClientAdapters, DiscoveryProjection, SessionFact, SessionProjection } from "./client-store.js";

const capabilities = ["scope.host", "scope.session", "session.create", "session.read-state", "session.archive", "session.restore"];

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

export const hostSessionAdapter: ClientAdapters["host"] = { readCatalog, readSession, restoreSession };
