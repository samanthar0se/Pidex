import { rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export const DEFAULT_DRAIN_TIMEOUT_MS = 15 * 60_000;
export const WINDOWS_SHUTDOWN_BUDGET_MS = 10_000;
export const PURGE_CONFIRMATION = "PURGE PIDEX AND MANAGED BACKUPS";
const DRAIN_POLL_INTERVAL_MS = 100;

export class HostLifecycleError extends Error {
  constructor(
    readonly code: "drain-timeout" | "purge-not-confirmed",
    message: string = code,
  ) {
    super(message);
    this.name = "HostLifecycleError";
  }
}

export interface LifecycleHooks {
  rejectMutations(): Promise<void> | void;
  resumeMutations(): Promise<void> | void;
  /** Includes queued, held, executing, cancelling, interactions, and lifecycle work. */
  remainingWork(): Promise<readonly string[]> | readonly string[];
  reportRemainingWork(work: readonly string[]): Promise<void> | void;
  /** Commits ordinary Stop outcomes before this resolves. */
  stopAffectedSessions(): Promise<void> | void;
  flushAndStopWorkers(): Promise<void> | void;
  restart?(): Promise<void> | void;
  removeStartupRegistration?(): Promise<void> | void;
  removeFirewallRules?(): Promise<void> | void;
  removeCurrentUserRootTrust?(): Promise<void> | void;
  now?(): number;
  sleep?(milliseconds: number): Promise<void>;
}

export interface UninstallLayout {
  installDirectory: string;
  disposableCaches?: readonly string[];
  /** Kept on normal uninstall; removed only by separately confirmed purge. */
  durableDataDirectory: string;
}

export interface PlannedLifecycleOptions {
  operation: "stop" | "restart" | "uninstall" | "purge";
  hooks: LifecycleHooks;
  force?: boolean;
  timeoutMs?: number;
  uninstall?: UninstallLayout;
  purgeConfirmation?: string;
  backupConsequencesAcknowledged?: boolean;
}

/** One authority boundary shared by stop, restart, uninstall, and purge. */
export async function coordinatePlannedLifecycle(
  options: PlannedLifecycleOptions,
): Promise<void> {
  if (
    options.operation === "purge" &&
    (options.purgeConfirmation !== PURGE_CONFIRMATION ||
      options.backupConsequencesAcknowledged !== true)
  ) {
    throw new HostLifecycleError(
      "purge-not-confirmed",
      `Purge deletes Host identity, Pi artifacts, and managed backups; type ${PURGE_CONFIRMATION} and acknowledge backup consequences.`,
    );
  }

  const { hooks } = options;
  const now = hooks.now ?? Date.now;
  const sleep =
    hooks.sleep ??
    (milliseconds =>
      new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds)));
  const drainTimeoutMs = Math.min(
    options.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS,
    DEFAULT_DRAIN_TIMEOUT_MS,
  );
  const drainDeadline = now() + drainTimeoutMs;
  let shouldResumeMutations = true;

  await hooks.rejectMutations();
  try {
    if (options.force) {
      await hooks.stopAffectedSessions();
    }

    while (true) {
      const remainingWork = await hooks.remainingWork();
      await hooks.reportRemainingWork(remainingWork);
      if (remainingWork.length === 0) {
        break;
      }
      if (now() >= drainDeadline) {
        throw new HostLifecycleError("drain-timeout");
      }
      await sleep(
        Math.min(
          DRAIN_POLL_INTERVAL_MS,
          Math.max(1, drainDeadline - now()),
        ),
      );
    }

    await hooks.flushAndStopWorkers();
    switch (options.operation) {
      case "restart":
        await hooks.restart?.();
        break;
      case "uninstall":
      case "purge":
        if (!options.uninstall) {
          throw new Error("Uninstall layout is required");
        }
        await removeInstallation(
          options.uninstall,
          hooks,
          options.operation === "purge",
        );
        shouldResumeMutations = false;
        break;
      case "stop":
        shouldResumeMutations = false;
        break;
    }
  } catch (cause) {
    await hooks.resumeMutations();
    shouldResumeMutations = false;
    throw cause;
  } finally {
    if (shouldResumeMutations) {
      await hooks.resumeMutations();
    }
  }
}

async function removeInstallation(
  layout: UninstallLayout,
  hooks: LifecycleHooks,
  purge: boolean,
): Promise<void> {
  await hooks.removeStartupRegistration?.();
  await hooks.removeFirewallRules?.();
  await hooks.removeCurrentUserRootTrust?.();

  const durableDataDirectory = resolve(layout.durableDataDirectory);
  const disposablePaths = [
    layout.installDirectory,
    ...(layout.disposableCaches ?? []),
  ];
  for (const disposablePath of disposablePaths) {
    if (isSameOrDescendantPath(resolve(disposablePath), durableDataDirectory)) {
      throw new Error(
        "Refusing to remove an installation path containing durable Host data",
      );
    }
    await rm(disposablePath, { recursive: true, force: true });
  }
  if (purge) {
    await rm(durableDataDirectory, { recursive: true, force: true });
  }
}

function isSameOrDescendantPath(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  );
}

export interface WindowsShutdownHooks {
  rejectMutations(): Promise<void> | void;
  /** Persists provable outcomes and requests cooperative abort; it may hang. */
  flushAndCooperativelyAbort(): Promise<void> | void;
  /** Closes the launcher Job, guaranteeing orphan-free process teardown. */
  closeSupervisionJob(): Promise<void> | void;
  budgetMs?: number;
}

export async function coordinateWindowsShutdown(
  hooks: WindowsShutdownHooks,
): Promise<void> {
  await hooks.rejectMutations();
  const shutdownBudgetMs = Math.min(
    hooks.budgetMs ?? WINDOWS_SHUTDOWN_BUDGET_MS,
    WINDOWS_SHUTDOWN_BUDGET_MS,
  );
  let shutdownTimer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => hooks.flushAndCooperativelyAbort()),
      new Promise<void>(resolveTimeout => {
        shutdownTimer = setTimeout(resolveTimeout, shutdownBudgetMs);
      }),
    ]);
  } finally {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
    }
    await hooks.closeSupervisionJob();
  }
}
