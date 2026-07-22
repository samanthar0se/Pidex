export type CommandEnvelope = Readonly<{
  version: number;
  type: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type CommandJournalState = "reserved" | "sent" | "uncertain" | "terminal" | "reconciled";

interface DraftRecord { text: string; revision: number; generation: number }
export interface DraftConflict extends DraftRecord { conflictId: string; createdAt: string }
export interface CommandJournalEntry {
  commandId: string;
  envelope: CommandEnvelope;
  state: CommandJournalState;
  generation: number;
}

interface EnvironmentState {
  revision: number;
  continuityGeneration: number;
  drafts: Record<string, DraftRecord>;
  draftConflicts: Record<string, DraftConflict[]>;
  preferences: Record<string, unknown>;
  caches: Record<string, unknown>;
  synchronizationMetadata: Record<string, unknown>;
  commands: Record<string, CommandJournalEntry>;
}

const emptyState = (): EnvironmentState => ({
  revision: 0, continuityGeneration: 0, drafts: {}, draftConflicts: {}, preferences: {}, caches: {},
  synchronizationMetadata: {}, commands: {},
});

export interface ClientEnvironmentStorage {
  inspect<T>(select: (state: EnvironmentState) => T): Promise<T>;
  transact<T>(operation: (state: EnvironmentState) => T): Promise<{ value: T; revision: number }>;
  subscribe(listener: (revision: number) => void): () => void;
}

/** Deterministic implementation for non-browser environments and concurrency tests. */
export class MemoryClientEnvironmentStorage implements ClientEnvironmentStorage {
  private state = emptyState();
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
  private readonly channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("pidex-client-environment");

  async inspect<T>(select: (state: EnvironmentState) => T): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction("environment", "readonly").objectStore("environment").get("state");
      request.onsuccess = () => resolve(structuredClone(select((request.result as EnvironmentState | undefined) ?? emptyState())));
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
          const state = (read.result as EnvironmentState | undefined) ?? emptyState();
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

export class ClientEnvironment {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly storage: ClientEnvironmentStorage) {}

  subscribe(listener: (change: { revision: number }) => void) {
    return this.storage.subscribe(revision => listener({ revision }));
  }

  async continuityGeneration() { return (await this.read(state => state.continuityGeneration)); }

  async advanceContinuity() {
    return (await this.transact(state => ++state.continuityGeneration)).value;
  }

  async readDraft(sessionId: string) {
    return this.read(state => state.drafts[sessionId] ?? {
      text: "", revision: 0, generation: state.continuityGeneration,
    });
  }

  async saveDraft(sessionId: string, text: string, expectedRevision: number, generation: number) {
    return (await this.transact(state => {
      this.assertGeneration(state, generation);
      const current = state.drafts[sessionId];
      const revision = current?.revision ?? 0;
      if (revision !== expectedRevision) {
        const conflict: DraftConflict = {
          conflictId: crypto.randomUUID(), text, revision: expectedRevision, generation,
          createdAt: new Date().toISOString(),
        };
        (state.draftConflicts[sessionId] ??= []).push(conflict);
        return { kind: "conflict" as const, conflict };
      }
      state.drafts[sessionId] = { text, revision: revision + 1, generation };
      return { kind: "saved" as const, revision: revision + 1 };
    })).value;
  }

  async listDraftConflicts(sessionId: string) {
    return this.read(state => state.draftConflicts[sessionId] ?? []);
  }

  readPreference<T>(key: string) { return this.read(state => state.preferences[key] as T | undefined); }
  writePreference(key: string, value: unknown, generation: number) { return this.writeObject("preferences", key, value, generation); }
  readCache<T>(key: string) { return this.read(state => state.caches[key] as T | undefined); }
  writeCache(key: string, value: unknown, generation: number) { return this.writeObject("caches", key, value, generation); }
  writeSynchronizationMetadata(key: string, value: unknown, generation: number) {
    return this.writeObject("synchronizationMetadata", key, value, generation);
  }

  async reserveCommand(commandId: string, envelope: CommandEnvelope, generation: number) {
    return (await this.transact(state => {
      this.assertGeneration(state, generation);
      const existing = state.commands[commandId];
      if (existing) {
        if (canonical(existing.envelope) !== canonical(envelope)) throw new Error("Command ID has a different envelope");
        return existing;
      }
      return state.commands[commandId] = { commandId, envelope: structuredClone(envelope), state: "reserved", generation };
    })).value;
  }

  async advanceCommand(commandId: string, next: CommandJournalState, generation: number) {
    return (await this.transact(state => {
      this.assertGeneration(state, generation);
      const entry = state.commands[commandId];
      if (!entry) throw new Error("Command must be durably reserved before it is sent");
      if (commandRank(next) < commandRank(entry.state)) throw new Error("Command journal cannot move backward");
      entry.state = next;
      return entry;
    })).value;
  }

  unresolvedCommands() {
    return this.read(state => Object.values(state.commands).filter(entry => entry.state !== "reconciled"));
  }

  async reconcileUncertainCommands(
    scopesAreCurrent: boolean,
    reconcile: (commandId: string, envelope: CommandEnvelope) => Promise<"terminal" | "uncertain">,
  ) {
    if (!scopesAreCurrent) throw new Error("Command reconciliation requires current scopes");
    const generation = await this.continuityGeneration();
    for (const entry of await this.unresolvedCommands()) {
      if (entry.generation !== generation || entry.state === "reserved") continue;
      const result = await reconcile(entry.commandId, structuredClone(entry.envelope));
      await this.advanceCommand(entry.commandId, result === "terminal" ? "reconciled" : "uncertain", generation);
    }
  }

  async settle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private transact<T>(operation: (state: EnvironmentState) => T) {
    const transaction = this.storage.transact(operation);
    this.pending.add(transaction);
    void transaction.then(
      () => this.pending.delete(transaction),
      () => this.pending.delete(transaction),
    );
    return transaction;
  }

  private async writeObject(area: "preferences" | "caches" | "synchronizationMetadata", key: string, value: unknown, generation: number) {
    await this.transact(state => { this.assertGeneration(state, generation); state[area][key] = structuredClone(value); });
  }

  private async read<T>(select: (state: EnvironmentState) => T): Promise<T> {
    return this.storage.inspect(select);
  }

  private assertGeneration(state: EnvironmentState, generation: number) {
    if (state.continuityGeneration !== generation) throw new Error("Client environment continuity changed");
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function commandRank(state: CommandJournalState) {
  return ({ reserved: 0, sent: 1, uncertain: 2, terminal: 3, reconciled: 4 } as const)[state];
}
