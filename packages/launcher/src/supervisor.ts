export const STARTUP_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
export const READINESS_DEADLINE_MS = 15_000;

export interface StartupState {
  state: "ready" | "circuit-open";
  attempts: number;
  cause?: string;
}

export interface SupervisorOperations {
  acquireUserLock(): Promise<boolean>;
  startRelease(readinessDeadlineMs: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  reportStatus?(status: StartupState): Promise<void>;
}

export async function superviseStartup(operations: SupervisorOperations): Promise<StartupState> {
  if (!(await operations.acquireUserLock())) throw new Error("Pidex Host is already running");
  let cause = "Unknown startup failure";

  for (let attempt = 0; attempt <= STARTUP_BACKOFF_MS.length; attempt += 1) {
    try {
      await operations.startRelease(READINESS_DEADLINE_MS);
      const status: StartupState = { state: "ready", attempts: attempt + 1 };
      await operations.reportStatus?.(status);
      return status;
    } catch (error) {
      cause = error instanceof Error ? error.message : String(error);
      if (attempt < STARTUP_BACKOFF_MS.length) await operations.sleep(STARTUP_BACKOFF_MS[attempt]!);
    }
  }
  const status: StartupState = { state: "circuit-open", attempts: 6, cause };
  await operations.reportStatus?.(status);
  return status;
}

/** Explicit retry entry point used by the Host-local CLI/recovery surface. */
export async function retryStartup(operations: SupervisorOperations): Promise<StartupState> {
  return superviseStartup(operations);
}
