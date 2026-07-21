import type { ClientAdapters, SessionProjection } from "./client-store.js";

const capabilities = ["scope.host", "scope.session", "session.create", "session.read-state"];

function readFromHost(sessionId: string): Promise<SessionProjection> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/control`);
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("Host synchronization timed out")); }, 10_000);
    socket.onerror = () => reject(new Error("Host unavailable"));
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "host.hello") {
        socket.send(JSON.stringify({
          type: "client.hello", expectedHostId: message.hostId,
          protocols: [{ major: 1, minor: 2 }],
          capabilities: capabilities.map(id => ({ id, minVersion: 1, maxVersion: 1 })),
        }));
      } else if (message.type === "host.snapshot") {
        socket.send(JSON.stringify({ type: "scope.set", sessionIds: [sessionId], protocolVersion: "1.2", resourceRevisions: {} }));
      } else if (message.type === "scope.reset" && message.barrier?.scope?.kind === "session") {
        window.clearTimeout(timeout); socket.close();
        resolve({ session: message.snapshot.session, timeline: message.snapshot.timelineWindow.entries });
      }
    };
  });
}

function draftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pidex-client", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function draftOperation<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const request = operation(database.transaction("drafts", mode).objectStore("drafts"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const productionAdapters: ClientAdapters = {
  host: { readSession: readFromHost },
  drafts: {
    async read(id) { return (await draftOperation("readonly", store => store.get(id)) as string | undefined) ?? ""; },
    async write(id, value) { await draftOperation("readwrite", store => store.put(value, id)); },
  },
  routing: { replace(path) { history.replaceState({}, "", path); } },
  identity: { newId: () => crypto.randomUUID(), now: () => Date.now() },
};
