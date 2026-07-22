import {
  assertContinuityGeneration,
  type DraftConflict,
  type EnvironmentOperations,
} from "./client-environment-state.js";

export class ClientDraftStore {
  constructor(private readonly environment: EnvironmentOperations) {}

  read(sessionId: string) {
    return this.environment.inspect(state => state.drafts[sessionId] ?? {
      text: "",
      revision: 0,
      generation: state.continuityGeneration,
    });
  }

  async save(sessionId: string, text: string, expectedRevision: number, generation: number) {
    return (await this.environment.transact(state => {
      assertContinuityGeneration(state, generation);
      const current = state.drafts[sessionId];
      const revision = current?.revision ?? 0;
      if (revision !== expectedRevision) {
        const conflict: DraftConflict = {
          conflictId: crypto.randomUUID(),
          text,
          revision: expectedRevision,
          generation,
          createdAt: new Date().toISOString(),
        };
        (state.draftConflicts[sessionId] ??= []).push(conflict);
        return { kind: "conflict" as const, conflict };
      }

      state.drafts[sessionId] = { text, revision: revision + 1, generation };
      return { kind: "saved" as const, revision: revision + 1 };
    })).value;
  }

  listConflicts(sessionId: string) {
    return this.environment.inspect(state => state.draftConflicts[sessionId] ?? []);
  }
}
