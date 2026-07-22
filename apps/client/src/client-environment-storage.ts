import {
  createEmptyEnvironmentState,
  type EnvironmentOperations,
  type EnvironmentState,
} from "./client-environment-state.js";

export interface ClientEnvironmentStorage extends EnvironmentOperations {
  subscribe(listener: (revision: number) => void): () => void;
}

/** Deterministic implementation for non-browser environments and concurrency tests. */
export class MemoryClientEnvironmentStorage implements ClientEnvironmentStorage {
  private state = createEmptyEnvironmentState();
  private tail = Promise.resolve();
  private listeners = new Set<(revision: number) => void>();

  async inspect<T>(select: (state: EnvironmentState) => T) {
    await this.tail;
    return structuredClone(select(this.state));
  }

  transact<T>(operation: (state: EnvironmentState) => T): Promise<{ value: T; revision: number }> {
    const result = this.tail.then(async () => {
      const working = structuredClone(this.state);
      const value = operation(working);
      working.revision = this.state.revision + 1;
      this.state = working;
      for (const listener of this.listeners) listener(working.revision);
      return { value, revision: working.revision };
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  subscribe(listener: (revision: number) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** One-record IndexedDB transactions make continuity checks and writes indivisible across tabs. */
export class IndexedDbClientEnvironmentStorage implements ClientEnvironmentStorage {
  private readonly channel = typeof indexedDB === "undefined" || typeof BroadcastChannel === "undefined"
    ? undefined
    : new BroadcastChannel("pidex-client-environment");

  async inspect<T>(select: (state: EnvironmentState) => T): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction("environment", "readonly").objectStore("environment").get("state");
      request.onsuccess = () => {
        const state = (request.result as EnvironmentState | undefined) ?? createEmptyEnvironmentState();
        resolve(structuredClone(select(state)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async transact<T>(operation: (state: EnvironmentState) => T): Promise<{ value: T; revision: number }> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("environment", "readwrite");
      const store = transaction.objectStore("environment");
      const read = store.get("state");
      let result: { value: T; revision: number } | undefined;
      read.onerror = () => transaction.abort();
      read.onsuccess = () => {
        try {
          const state = (read.result as EnvironmentState | undefined) ?? createEmptyEnvironmentState();
          const value = operation(state);
          state.revision += 1;
          store.put(state, "state");
          result = { value, revision: state.revision };
        } catch (error) {
          reject(error);
          transaction.abort();
        }
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("Client environment transaction failed"));
      transaction.oncomplete = () => {
        if (!result) return reject(new Error("Client environment transaction did not complete"));
        this.channel?.postMessage(result.revision);
        resolve(result);
      };
    });
  }

  subscribe(listener: (revision: number) => void) {
    const receive = (event: MessageEvent<number>) => listener(event.data);
    this.channel?.addEventListener("message", receive);
    return () => this.channel?.removeEventListener("message", receive);
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("pidex-client-environment", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("environment");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
