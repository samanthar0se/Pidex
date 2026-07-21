import { resolve, join } from "node:path";
import { sourceReleaseIdFromClosureSha256 } from "../../local-control/src/index.js";
import { verifyPublishedSourceClosure, type SourceClosureEvidence } from "../../source/src/source-closure.js";

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export interface SourceUpdateCandidate {
  readonly releaseId: string;
  readonly closureSha256: string;
}

export interface SourceUpdateHooks {
  verifyCompatibility(evidence: SourceClosureEvidence): Promise<void> | void;
  stopAcceptingMutations(): Promise<void> | void;
  resumeAcceptingMutations(): Promise<void> | void;
  isQuiescent(): Promise<boolean> | boolean;
  prepareMigration(evidence: SourceClosureEvidence): Promise<() => Promise<void> | void>;
  activateRelease(evidence: SourceClosureEvidence): Promise<void>;
  hasAcceptedNewMutations(): Promise<boolean> | boolean;
  sleep?(milliseconds: number): Promise<void>;
  now?(): number;
}

export class SourceUpdateActivationError extends Error {
  constructor(readonly code: "identity-mismatch" | "quiescence-timeout" | "managed-recovery-required", message: string = code) {
    super(message);
    this.name = "SourceUpdateActivationError";
  }
}

/** Launcher-owned activation. The candidate carries identity only; its root is selected locally. */
export async function activateSourceUpdate(options: {
  releasesDirectory: string;
  expectedInstanceId: string;
  expectedOwningSid: string;
  peer: { instanceId: string; owningSid: string };
  candidate: SourceUpdateCandidate;
  hooks: SourceUpdateHooks;
  timeoutMs?: number;
}): Promise<SourceClosureEvidence> {
  if (options.peer.instanceId !== options.expectedInstanceId || options.peer.owningSid !== options.expectedOwningSid) {
    throw new SourceUpdateActivationError("identity-mismatch");
  }
  if (options.candidate.releaseId !== sourceReleaseIdFromClosureSha256(options.candidate.closureSha256)) {
    throw new SourceUpdateActivationError("identity-mismatch", "source update fingerprint mismatch");
  }

  const releaseDirectory = resolve(options.releasesDirectory, options.candidate.releaseId);
  if (releaseDirectory !== join(resolve(options.releasesDirectory), options.candidate.releaseId)) {
    throw new SourceUpdateActivationError("identity-mismatch", "source update root mismatch");
  }
  const evidence = verifyPublishedSourceClosure(releaseDirectory);
  if (evidence.releaseId !== options.candidate.releaseId || evidence.closureSha256 !== options.candidate.closureSha256) {
    throw new SourceUpdateActivationError("identity-mismatch", "source update content mismatch");
  }
  await options.hooks.verifyCompatibility(evidence);

  const now = options.hooks.now ?? Date.now;
  const sleep = options.hooks.sleep ?? (ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)));
  await options.hooks.stopAcceptingMutations();
  let rollbackMigration: (() => Promise<void> | void) | undefined;
  try {
    const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    while (!(await options.hooks.isQuiescent())) {
      if (now() >= deadline) throw new SourceUpdateActivationError("quiescence-timeout");
      await sleep(Math.min(100, Math.max(1, deadline - now())));
    }
    rollbackMigration = await options.hooks.prepareMigration(evidence);
    await options.hooks.activateRelease(evidence);
    return evidence;
  } catch (cause) {
    if (await options.hooks.hasAcceptedNewMutations()) {
      throw new SourceUpdateActivationError("managed-recovery-required", String(cause));
    }
    await rollbackMigration?.();
    throw cause;
  } finally {
    await options.hooks.resumeAcceptingMutations();
  }
}
