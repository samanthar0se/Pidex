import type { ClientAdapters, SessionProjection, TimelineChange } from "./client-store.js";

const capabilities = ["scope.host", "scope.session", "session.create", "session.read-state"];
const sockets = new Map<string, WebSocket>();
const listeners = new Map<string, Set<(change: TimelineChange) => void>>();

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
          type: "client.hello",
          expectedHostId: message.hostId,
          protocols: [{ major: 1, minor: 2 }],
          capabilities: capabilities.map(id => ({ id, minVersion: 1, maxVersion: 1 })),
        }));
      } else if (message.type === "host.snapshot") {
        socket.send(JSON.stringify({
          type: "scope.set",
          sessionIds: [sessionId],
          protocolVersion: "1.2",
          resourceRevisions: {},
        }));
      } else if (message.type === "scope.reset" && message.barrier?.scope?.kind === "session") {
        window.clearTimeout(timeout);
        sockets.set(sessionId, socket);
        resolve({
          session: message.snapshot.session,
          timeline: message.snapshot.timelineWindow.entries,
          olderCursor: message.snapshot.timelineWindow.olderCursor,
        });
      } else if (message.type === "timeline.change" && message.sessionId === sessionId) {
        listeners.get(sessionId)?.forEach(listener => listener(message));
      }
    };
  });
}

export const hostSessionAdapter: ClientAdapters["host"] = {
  readSession,
  watchSession(sessionId, listener) {
    const sessionListeners = listeners.get(sessionId) ?? new Set();
    sessionListeners.add(listener);
    listeners.set(sessionId, sessionListeners);
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
