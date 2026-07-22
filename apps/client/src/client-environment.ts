import { ClientCommandJournal } from "./client-command-journal.js";
import { ClientConvenienceStore } from "./client-convenience-store.js";
import { ClientDraftStore } from "./client-draft-store.js";
import { ClientSynchronizationMetadataStore } from "./client-synchronization-metadata-store.js";
import type { CommandEnvelope, CommandJournalState, EnvironmentOperations, EnvironmentState } from "./client-environment-state.js";
import type { ClientEnvironmentStorage } from "./client-environment-storage.js";

export type {
  CommandEnvelope,
  CommandJournalEntry,
  CommandJournalState,
  DraftConflict,
} from "./client-environment-state.js";
export {
  IndexedDbClientEnvironmentStorage,
  MemoryClientEnvironmentStorage,
} from "./client-environment-storage.js";
export type { ClientEnvironmentStorage } from "./client-environment-storage.js";

export class ClientEnvironment {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly drafts: ClientDraftStore;
  private readonly convenience: ClientConvenienceStore;
  private readonly synchronizationMetadata: ClientSynchronizationMetadataStore;
  private readonly commands: ClientCommandJournal;

  constructor(private readonly storage: ClientEnvironmentStorage) {
    const operations: EnvironmentOperations = {
      inspect: select => this.storage.inspect(select),
      transact: operation => this.transact(operation),
    };
    this.drafts = new ClientDraftStore(operations);
    this.convenience = new ClientConvenienceStore(operations);
    this.synchronizationMetadata = new ClientSynchronizationMetadataStore(operations);
    this.commands = new ClientCommandJournal(operations);
  }

  subscribe(listener: (change: { revision: number }) => void) {
    return this.storage.subscribe(revision => listener({ revision }));
  }

  async continuityGeneration() {
    return this.storage.inspect(state => state.continuityGeneration);
  }

  async advanceContinuity() {
    return (await this.transact(state => ++state.continuityGeneration)).value;
  }

  async readDraft(sessionId: string) {
    return this.drafts.read(sessionId);
  }

  async saveDraft(sessionId: string, text: string, expectedRevision: number, generation: number) {
    return this.drafts.save(sessionId, text, expectedRevision, generation);
  }

  async listDraftConflicts(sessionId: string) {
    return this.drafts.listConflicts(sessionId);
  }

  readPreference<T>(key: string) {
    return this.convenience.read<T>("preferences", key);
  }

  writePreference(key: string, value: unknown, generation: number) {
    return this.convenience.write("preferences", key, value, generation);
  }

  readCache<T>(key: string) {
    return this.convenience.read<T>("caches", key);
  }

  writeCache(key: string, value: unknown, generation: number) {
    return this.convenience.write("caches", key, value, generation);
  }

  writeSynchronizationMetadata(key: string, value: unknown, generation: number) {
    return this.synchronizationMetadata.write(key, value, generation);
  }

  async reserveCommand(commandId: string, envelope: CommandEnvelope, generation: number) {
    return this.commands.reserve(commandId, envelope, generation);
  }

  async advanceCommand(commandId: string, next: CommandJournalState, generation: number) {
    return this.commands.advance(commandId, next, generation);
  }

  unresolvedCommands() {
    return this.commands.unresolved();
  }

  async reconcileUncertainCommands(
    scopesAreCurrent: boolean,
    reconcile: (commandId: string, envelope: CommandEnvelope) => Promise<"terminal" | "uncertain">,
  ) {
    if (!scopesAreCurrent) throw new Error("Command reconciliation requires current scopes");
    const generation = await this.continuityGeneration();
    await this.commands.reconcile(scopesAreCurrent, generation, reconcile);
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
}
