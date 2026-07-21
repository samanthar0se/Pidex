export type CliExit = "healthy" | "degraded" | "unavailable" | "incompatible" | "control-failure";

export interface LocalStatus {
  launcher: { state: "ready" | "degraded" | "stopped" | "circuit-open" | "recovery-only" | "incompatible"; attempts: number; cause?: string };
  daemon?: { freshness: "current" | "stale"; mode: "normal" | "recovery-only"; health: ReadonlyArray<{ scope: string; availability: string; freshness: "current" | "stale"; code: string }> };
}

export interface StatusProjection {
  readonly exit: CliExit;
  readonly human: string;
  readonly json: LocalStatus;
}

export function projectStatus(status: LocalStatus): StatusProjection {
  let exit: CliExit = "healthy";
  if (status.launcher.state === "incompatible") exit = "incompatible";
  else if (["stopped", "circuit-open", "recovery-only"].includes(status.launcher.state)) exit = "unavailable";
  else if (status.launcher.state === "degraded" || status.daemon?.health.some(item => item.availability !== "available")) exit = "degraded";
  const lines = [`Launcher: ${status.launcher.state} (${status.launcher.attempts} attempt${status.launcher.attempts === 1 ? "" : "s"})`];
  if (status.launcher.cause) lines.push(`Cause: ${status.launcher.cause}`);
  if (status.daemon?.freshness === "stale") lines.push("STALE daemon observation (not current Authority state)");
  for (const item of status.daemon?.health ?? []) {
    lines.push(`${item.availability.toUpperCase()}: ${item.scope} — ${item.code}${item.freshness === "stale" ? " [STALE]" : ""}`);
  }
  return { exit, human: lines.join("\n"), json: status };
}
