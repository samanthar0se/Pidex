import {
  assertContinuityGeneration,
  type CommandEnvelope,
  type CommandJournalState,
  type EnvironmentOperations,
} from "./client-environment-state.js";

export class ClientCommandJournal {
  constructor(private readonly environment: EnvironmentOperations) {}

  async reserve(commandId: string, envelope: CommandEnvelope, generation: number) {
    return (await this.environment.transact(state => {
      assertContinuityGeneration(state, generation);
      const existing = state.commands[commandId];
      if (existing) {
        if (canonical(existing.envelope) !== canonical(envelope)) {
          throw new Error("Command ID has a different envelope");
        }
        return existing;
      }

      return state.commands[commandId] = {
        commandId,
        envelope: structuredClone(envelope),
        state: "reserved",
        generation,
      };
    })).value;
  }

  async advance(commandId: string, next: CommandJournalState, generation: number) {
    return (await this.environment.transact(state => {
      assertContinuityGeneration(state, generation);
      const entry = state.commands[commandId];
      if (!entry) throw new Error("Command must be durably reserved before it is sent");
      if (commandRank(next) < commandRank(entry.state)) {
        throw new Error("Command journal cannot move backward");
      }
      entry.state = next;
      return entry;
    })).value;
  }

  unresolved() {
    return this.environment.inspect(state => Object.values(state.commands).filter(entry => entry.state !== "reconciled"));
  }

  async reconcile(
    scopesAreCurrent: boolean,
    generation: number,
    reconcile: (commandId: string, envelope: CommandEnvelope) => Promise<"terminal" | "uncertain">,
  ) {
    if (!scopesAreCurrent) throw new Error("Command reconciliation requires current scopes");
    for (const entry of await this.unresolved()) {
      if (entry.generation !== generation || entry.state === "reserved") continue;
      const result = await reconcile(entry.commandId, structuredClone(entry.envelope));
      await this.advance(entry.commandId, result === "terminal" ? "reconciled" : "uncertain", generation);
    }
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const properties = Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${properties.join(",")}}`;
  }
  return JSON.stringify(value);
}

function commandRank(state: CommandJournalState) {
  return ({ reserved: 0, sent: 1, uncertain: 2, terminal: 3, reconciled: 4 } as const)[state];
}
