import { join } from "node:path";
import type { HostAdapters } from "../../adapters/src/index.js";
import {
  AuthorityGenerationStore,
  type AuthorityGenerationEnvelope,
  type RecoveryWarning,
} from "./authority-generations.js";
import { AuthorityStore } from "./store.js";

export type ProductionRecoveryResult =
  | {
      kind: "selected";
      generation: AuthorityGenerationEnvelope;
      warning?: RecoveryWarning;
    }
  | {
      kind: "fail-closed";
      reason:
        | "ambiguous-authority"
        | "broken-lineage"
        | "incomplete-closure"
        | "invalid-authority";
    };

type RecoveryFailureReason = Extract<
  ProductionRecoveryResult,
  { kind: "fail-closed" }
>["reason"];

/**
 * The single fresh-process recovery witness used by startup and crash tests.
 * Selection and accepted-work reconciliation deliberately happen through the
 * production stores rather than through an oracle-owned model.
 */
export function recoverProductionAuthority(
  root: string,
  adapters: HostAdapters,
  now: number,
): ProductionRecoveryResult {
  let resolution;
  try {
    resolution = new AuthorityGenerationStore(root).resolve();
  } catch (error) {
    return { kind: "fail-closed", reason: classifyRecoveryFailure(error) };
  }

  const databasePath = join(
    root,
    "generations",
    resolution.selected.generationId,
    "authority.sqlite",
  );
  try {
    const authority = new AuthorityStore(databasePath, adapters);
    try {
      authority.reconcileAcceptedRuns(now);
    } finally {
      authority.close();
    }
  } catch {
    return { kind: "fail-closed", reason: "invalid-authority" };
  }

  return {
    kind: "selected",
    generation: resolution.selected,
    ...(resolution.warning ? { warning: resolution.warning } : {}),
  };
}

function classifyRecoveryFailure(error: unknown): RecoveryFailureReason {
  const message = error instanceof Error ? error.message : "";
  if (/ambiguous/i.test(message)) return "ambiguous-authority";
  if (/lineage/i.test(message)) return "broken-lineage";
  if (/valid Authority generation/i.test(message)) return "incomplete-closure";
  return "invalid-authority";
}
