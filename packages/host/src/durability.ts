import type {
  StorageVolumeFacts,
  WindowsPlatformAdapter,
} from "../../adapters/src/index.js";
import {
  durabilityRoles,
  type DurabilityCoverage,
  type HostStatus,
} from "../../protocol/src/status.js";

type DurabilityRole = (typeof durabilityRoles)[number];
type DurabilityRoleCoverage = DurabilityCoverage["roles"][number];

export function pendingDurabilityCoverage(): DurabilityCoverage {
  return {
    aggregate: "indeterminate",
    assessment: "assessment-pending",
    roles: durabilityRoles.map(role => ({
      role,
      state: "indeterminate",
      reason: "assessment-pending",
    })),
  };
}

export async function assessDurabilityCoverage(
  windows: WindowsPlatformAdapter,
  pathsByRole: Record<DurabilityRole, string>,
  timeoutMs: number,
): Promise<DurabilityCoverage> {
  const roles = await Promise.all(
    durabilityRoles.map(role =>
      assessDurabilityRole(windows, role, pathsByRole[role], timeoutMs),
    ),
  );

  return {
    aggregate: aggregateDurabilityCoverage(roles),
    assessment: "complete",
    roles,
  };
}

async function assessDurabilityRole(
  windows: WindowsPlatformAdapter,
  role: DurabilityRole,
  path: string,
  timeoutMs: number,
): Promise<DurabilityRoleCoverage> {
  try {
    const facts = await classifyStorageWithin(windows, path, timeoutMs);
    if (facts.fileSystem === "NTFS" && facts.driveType === "fixed") {
      return { role, state: "covered", reason: "fixed-ntfs" };
    }

    const hasUnsupportedFileSystem =
      facts.fileSystem !== undefined && facts.fileSystem !== "NTFS";
    const hasUnsupportedDriveType =
      facts.driveType !== undefined && facts.driveType !== "fixed";
    if (hasUnsupportedFileSystem || hasUnsupportedDriveType) {
      return {
        role,
        state: "outside-boundary",
        reason: "outside-fixed-ntfs",
      };
    }
  } catch {
    // Unsupported, failed, and timed-out classifications have the same outcome.
  }

  return {
    role,
    state: "indeterminate",
    reason: "classification-unavailable",
  };
}

async function classifyStorageWithin(
  windows: WindowsPlatformAdapter,
  path: string,
  timeoutMs: number,
): Promise<StorageVolumeFacts> {
  let timeout: NodeJS.Timeout | undefined;
  const classificationTimeout = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("classification-timeout")),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([
      windows.classifyStorage(path),
      classificationTimeout,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function aggregateDurabilityCoverage(
  roles: DurabilityRoleCoverage[],
): DurabilityCoverage["aggregate"] {
  if (roles.some(role => role.state === "outside-boundary")) {
    return "outside-boundary";
  }
  if (roles.some(role => role.state === "indeterminate")) {
    return "indeterminate";
  }
  return "covered";
}

export function durabilityWarningsFor(
  coverage: DurabilityCoverage,
): HostStatus["warnings"] {
  const warnings: HostStatus["warnings"] = [];

  for (const role of coverage.roles) {
    if (role.state === "covered") {
      continue;
    }

    let detail: string;
    if (role.state === "outside-boundary") {
      detail = "This storage role is outside the fixed NTFS Durability boundary.";
    } else {
      detail = "Durability coverage for this storage role could not be determined.";
    }

    warnings.push({
      severity: "medium",
      code: "durability-coverage-degraded",
      role: role.role,
      state: role.state,
      reason: role.reason,
      detail,
    });
  }

  return warnings;
}
