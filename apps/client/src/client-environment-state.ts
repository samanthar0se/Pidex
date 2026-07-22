export type CommandEnvelope = Readonly<{
  version: number;
  type: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type CommandJournalState = "reserved" | "sent" | "uncertain" | "terminal" | "reconciled";

export interface DraftRecord {
  text: string;
  revision: number;
  generation: number;
}

export interface DraftConflict extends DraftRecord {
  conflictId: string;
  createdAt: string;
}

export interface CommandJournalEntry {
  commandId: string;
  envelope: CommandEnvelope;
  state: CommandJournalState;
  generation: number;
}

export interface EnvironmentState {
  revision: number;
  continuityGeneration: number;
  drafts: Record<string, DraftRecord>;
  draftConflicts: Record<string, DraftConflict[]>;
  preferences: Record<string, unknown>;
  caches: Record<string, unknown>;
  synchronizationMetadata: Record<string, unknown>;
  commands: Record<string, CommandJournalEntry>;
}

export interface EnvironmentOperations {
  inspect<T>(select: (state: EnvironmentState) => T): Promise<T>;
  transact<T>(operation: (state: EnvironmentState) => T): Promise<{ value: T; revision: number }>;
}

export function createEmptyEnvironmentState(): EnvironmentState {
  return {
    revision: 0,
    continuityGeneration: 0,
    drafts: {},
    draftConflicts: {},
    preferences: {},
    caches: {},
    synchronizationMetadata: {},
    commands: {},
  };
}

export function assertContinuityGeneration(state: EnvironmentState, generation: number): void {
  if (state.continuityGeneration !== generation) {
    throw new Error("Client environment continuity changed");
  }
}
