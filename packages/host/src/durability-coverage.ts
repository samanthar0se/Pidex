import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";
import {
  durabilityRoles,
  type CoverageState,
  type DurabilityCoverage,
  type DurabilityRole,
  type RoleCoverage,
} from "../../protocol/src/status.js";

export type {
  CoverageState,
  DurabilityCoverage,
  DurabilityRole,
  RoleCoverage,
} from "../../protocol/src/status.js";

export interface CoverageDiagnostic {
  type: "durability-coverage-transition";
  role: DurabilityRole;
  from: CoverageState;
  to: CoverageState;
  reason: string;
}

export class DurabilityCoverageMonitor {
  #roots: Record<DurabilityRole, string>;
  #coverage: DurabilityCoverage;
  #refreshInProgress?: Promise<DurabilityCoverage>;

  constructor(
    private readonly windows: WindowsPlatformAdapter,
    roots: Record<DurabilityRole, string>,
    private readonly now: () => number,
    private readonly timeoutMs: number,
    private readonly diagnostic: (event: CoverageDiagnostic) => void,
  ) {
    this.#roots = roots;
    this.#coverage = this.createPendingCoverage();
  }

  current(): DurabilityCoverage {
    return structuredClone(this.#coverage);
  }

  setRoots(roots: Partial<Record<DurabilityRole, string>>): void {
    this.#roots = { ...this.#roots, ...roots };
    void this.refresh();
  }

  refresh(): Promise<DurabilityCoverage> {
    if (!this.#refreshInProgress) {
      this.#refreshInProgress = this.assess().finally(() => {
        this.#refreshInProgress = undefined;
      });
    }
    return this.#refreshInProgress;
  }

  private async assess(): Promise<DurabilityCoverage> {
    const previousStates = new Map(
      this.#coverage.roles.map(role => [role.role, role.state]),
    );
    const roles = await Promise.all(
      durabilityRoles.map(role => this.assessRole(role)),
    );

    this.#coverage = {
      aggregate: aggregateCoverage(roles),
      assessment: "complete",
      roles,
      assessedAt: this.now(),
    };
    this.reportTransitions(previousStates, roles);

    return this.current();
  }

  private async assessRole(role: DurabilityRole): Promise<RoleCoverage> {
    try {
      const classification = await withTimeout(
        this.windows.classifyStorageRoot(this.#roots[role]),
        this.timeoutMs,
      );
      const isCovered =
        classification.fileSystem.toUpperCase() === "NTFS" &&
        classification.driveType === "fixed";
      if (isCovered) {
        return { role, state: "covered", reason: "fixed-ntfs" };
      }
      return {
        role,
        state: "outside-boundary",
        reason: "storage-outside-fixed-ntfs",
      };
    } catch {
      return {
        role,
        state: "indeterminate",
        reason: "classification-unavailable",
      };
    }
  }

  private reportTransitions(
    previousStates: Map<DurabilityRole, CoverageState>,
    roles: RoleCoverage[],
  ): void {
    for (const role of roles) {
      const previousState = previousStates.get(role.role) ?? "indeterminate";
      if (previousState === role.state) {
        continue;
      }
      this.diagnostic({
        type: "durability-coverage-transition",
        role: role.role,
        from: previousState,
        to: role.state,
        reason: role.reason,
      });
    }
  }

  private createPendingCoverage(): DurabilityCoverage {
    return {
      aggregate: "indeterminate",
      assessment: "assessment-pending",
      assessedAt: this.now(),
      roles: durabilityRoles.map(role => ({
        role,
        state: "indeterminate",
        reason: "assessment-pending",
      })),
    };
  }
}

function aggregateCoverage(roles: RoleCoverage[]): CoverageState {
  if (roles.some(role => role.state === "outside-boundary")) {
    return "outside-boundary";
  }
  if (roles.some(role => role.state === "indeterminate")) {
    return "indeterminate";
  }
  return "covered";
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("coverage-refresh-timeout")),
      timeoutMs,
    );
    work.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
