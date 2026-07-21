import type { ClientAdapters } from "./client-store.js";

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pidex-client", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function performDraftOperation<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const objectStore = database.transaction("drafts", mode).objectStore("drafts");
    const request = operation(objectStore);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const draftAdapter: ClientAdapters["drafts"] = {
  async read(sessionId) {
    return (await performDraftOperation("readonly", store => store.get(sessionId)) as string | undefined) ?? "";
  },
  async write(sessionId, value) {
    await performDraftOperation("readwrite", store => store.put(value, sessionId));
  },
};
