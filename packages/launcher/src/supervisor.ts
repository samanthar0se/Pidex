export const STARTUP_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
export const READINESS_DEADLINE_MS = 15_000;

export type StartupState =
  | { state: "ready"; attempts: number }
  | { state: "circuit-open"; attempts: number; cause: string };

export interface SupervisorOperations {
  acquireUserLock(): Promise<boolean>;
  startRelease(readinessDeadlineMs: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  reportStatus?(status: StartupState): Promise<void>;
}

export async function superviseStartup(
  operations: SupervisorOperations,
): Promise<StartupState> {
  if (!(await operations.acquireUserLock())) {
    throw new Error("Pidex Host is already running");
  }

  const totalAttempts = STARTUP_BACKOFF_MS.length + 1;
  let lastFailureCause = "Unknown startup failure";

  for (
    let attemptNumber = 1;
    attemptNumber <= totalAttempts;
    attemptNumber += 1
  ) {
    try {
      await operations.startRelease(READINESS_DEADLINE_MS);
      const status: StartupState = {
        state: "ready",
        attempts: attemptNumber,
      };
      await operations.reportStatus?.(status);
      return status;
    } catch (error) {
      lastFailureCause = error instanceof Error ? error.message : String(error);
      const retryDelay = STARTUP_BACKOFF_MS[attemptNumber - 1];
      if (retryDelay !== undefined) {
        await operations.sleep(retryDelay);
      }
    }
  }

  const status: StartupState = {
    state: "circuit-open",
    attempts: totalAttempts,
    cause: lastFailureCause,
  };
  await operations.reportStatus?.(status);
  return status;
}

/** Explicit retry entry point used by the Host-local CLI/recovery surface. */
export async function retryStartup(
  operations: SupervisorOperations,
): Promise<StartupState> {
  return superviseStartup(operations);
}
