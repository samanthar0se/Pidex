import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

export type DurabilityRole = "host-data" | "installation-release" | "pi-checkpoint";
export type CoverageState = "covered" | "outside-boundary" | "indeterminate";
export interface RoleCoverage { role: DurabilityRole; state: CoverageState; reason: string }
export interface DurabilityCoverage { aggregate: CoverageState; roles: RoleCoverage[]; assessedAt: number }
export interface CoverageDiagnostic { type: "durability-coverage-transition"; role: DurabilityRole; from: CoverageState; to: CoverageState; reason: string }

export class DurabilityCoverageMonitor {
  #roots: Record<DurabilityRole, string>;
  #coverage: DurabilityCoverage;
  #refresh?: Promise<DurabilityCoverage>;

  constructor(
    private readonly windows: WindowsPlatformAdapter,
    roots: Record<DurabilityRole, string>,
    private readonly now: () => number,
    private readonly timeoutMs: number,
    private readonly diagnostic: (event: CoverageDiagnostic) => void,
  ) {
    this.#roots = roots;
    this.#coverage = this.pending();
  }

  current(): DurabilityCoverage { return structuredClone(this.#coverage); }
  setRoots(roots: Partial<Record<DurabilityRole, string>>): void {
    this.#roots = { ...this.#roots, ...roots };
    void this.refresh();
  }
  refresh(): Promise<DurabilityCoverage> {
    return this.#refresh ??= this.assess().finally(() => { this.#refresh = undefined; });
  }

  private async assess(): Promise<DurabilityCoverage> {
    const previous = new Map(this.#coverage.roles.map(item => [item.role, item.state]));
    const roles = await Promise.all((Object.keys(this.#roots) as DurabilityRole[]).map(async role => {
      try {
        const classification = await withTimeout(this.windows.classifyStorageRoot(this.#roots[role]), this.timeoutMs);
        return classification.fileSystem.toUpperCase() === "NTFS" && classification.driveType === "fixed"
          ? { role, state: "covered", reason: "fixed-ntfs" } as const
          : { role, state: "outside-boundary", reason: "storage-outside-fixed-ntfs" } as const;
      } catch {
        return { role, state: "indeterminate", reason: "classification-unavailable" } as const;
      }
    }));
    const aggregate = roles.some(item => item.state === "outside-boundary") ? "outside-boundary"
      : roles.some(item => item.state === "indeterminate") ? "indeterminate" : "covered";
    this.#coverage = { aggregate, roles, assessedAt: this.now() };
    for (const role of roles) {
      const from = previous.get(role.role) ?? "indeterminate";
      if (from !== role.state) this.diagnostic({ type: "durability-coverage-transition", role: role.role, from, to: role.state, reason: role.reason });
    }
    return this.current();
  }

  private pending(): DurabilityCoverage {
    return { aggregate: "indeterminate", assessedAt: this.now(), roles: (Object.keys(this.#roots) as DurabilityRole[]).map(role => ({ role, state: "indeterminate", reason: "assessment-pending" })) };
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("coverage-refresh-timeout")), timeoutMs);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
