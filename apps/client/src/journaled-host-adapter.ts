import type { ClientAdapters, CommandResult } from "./client-store.js";
import type { CommandEnvelope } from "./client-environment.js";
import { clientEnvironment } from "./environment-instance.js";

const mutations = new Set([
  "restoreSession", "createSession", "submitRun", "steerRun", "stopRun", "actOnHeldRun", "resolveInteraction",
]);

/** Journals the exact public adapter command before allowing its first network send. */
export function journalHostAdapter(host: ClientAdapters["host"]): ClientAdapters["host"] {
  return new Proxy(host, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver) as unknown;
      if (property === "reconcileCommand") return async (commandId: string) => {
        const entry = (await clientEnvironment.unresolvedCommands()).find(command => command.commandId === commandId);
        if (!entry) return { kind: "indeterminate" as const, reason: "original-command-envelope-unavailable" };
        const replay = Reflect.get(target, entry.envelope.type) as unknown;
        if (typeof replay !== "function") return { kind: "indeterminate" as const, reason: "original-command-type-unavailable" };
        const result = await (replay as (value: unknown) => Promise<CommandResult>).call(target, structuredClone(entry.envelope.payload));
        const generation = await clientEnvironment.continuityGeneration();
        await clientEnvironment.advanceCommand(commandId, result.kind === "uncertain" ? "uncertain" : "reconciled", generation);
        if (result.kind === "accepted" || result.kind === "rejected") return result;
        return { kind: "indeterminate" as const, reason: result.reason };
      };
      if (typeof property !== "string" || !mutations.has(property) || typeof original !== "function") return original;
      return async (command: Record<string, unknown>) => {
        const commandId = command.commandId;
        if (typeof commandId !== "string") return (original as (value: unknown) => unknown).call(target, command);
        const generation = await clientEnvironment.continuityGeneration();
        const envelope: CommandEnvelope = { version: 1, type: property, payload: structuredClone(command) };
        await clientEnvironment.reserveCommand(commandId, envelope, generation);
        await clientEnvironment.advanceCommand(commandId, "sent", generation);
        try {
          const result = await (original as (value: unknown) => Promise<CommandResult>).call(target, command);
          await clientEnvironment.advanceCommand(commandId, result.kind === "uncertain" ? "uncertain" : "terminal", generation);
          return result;
        } catch (error) {
          await clientEnvironment.advanceCommand(commandId, "uncertain", generation);
          throw error;
        }
      };
    },
  });
}
