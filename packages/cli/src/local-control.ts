import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { invocationSchema, operationReceiptSchema } from "../../local-control/src/index.js";
import { z } from "zod";

export interface CliTarget {
  readonly trustClass: "source" | "installed";
  readonly instanceId?: string;
  readonly manifestPath: string;
}

export interface CliTargetOptions {
  readonly explicitManifestPath?: string;
  readonly checkoutDirectory?: string;
  readonly profileDirectory?: string;
}

/** Resolves one target by identity. It never scans manifests, ports, or processes. */
export function resolveCliTarget(options: CliTargetOptions): CliTarget {
  if (options.explicitManifestPath !== undefined) {
    if (!isAbsolute(options.explicitManifestPath)) {
      throw new Error("explicit manifest path must be absolute");
    }
    return { trustClass: "installed", manifestPath: resolve(options.explicitManifestPath) };
  }
  if (!options.checkoutDirectory || !options.profileDirectory) {
    throw new Error("CLI requires an explicit target or prepared checkout marker");
  }
  let marker: unknown;
  try {
    marker = JSON.parse(readFileSync(join(resolve(options.checkoutDirectory), ".pidex-source-instance.json"), "utf8"));
  } catch {
    throw new Error("CLI requires an explicit target or prepared checkout marker");
  }
  if (!isSourceMarker(marker)) throw new Error("invalid source checkout marker");
  return {
    trustClass: "source",
    instanceId: marker.instanceId,
    manifestPath: resolve(options.profileDirectory, "Pidex", "Source", marker.instanceId, "launcher", "resolved-launch-manifest.json"),
  };
}

function isSourceMarker(value: unknown): value is { schemaVersion: 1; instanceId: string } {
  return typeof value === "object" && value !== null &&
    "schemaVersion" in value && value.schemaVersion === 1 &&
    "instanceId" in value && typeof value.instanceId === "string" && value.instanceId.length > 0;
}

type Receipt = z.output<typeof operationReceiptSchema>;
type Invocation = z.output<typeof invocationSchema>;

export interface LocalControlTransport {
  request(method: string, payload: unknown): Promise<unknown>;
}

export class CliControlClient {
  constructor(
    private readonly transport: LocalControlTransport,
    private readonly createInvocationId: () => string = randomUUID,
  ) {}

  async status(): Promise<StatusProjection> {
    return projectStatus(await this.transport.request("status", null) as LocalStatus);
  }

  /** A transport failure is ambiguous: reconcile the same invocation, never resubmit it. */
  async invoke(input: Omit<Invocation, "invocationId">): Promise<Receipt> {
    const invocation = invocationSchema.parse({ ...input, invocationId: this.createInvocationId() });
    try {
      return operationReceiptSchema.parse(await this.transport.request("operation.invoke", invocation));
    } catch (deliveryError) {
      try {
        return operationReceiptSchema.parse(await this.transport.request(
          "operation.lookup-invocation",
          { invocationId: invocation.invocationId },
        ));
      } catch {
        throw deliveryError;
      }
    }
  }

  async follow(operationId: string, afterSequence = -1): Promise<{ receipt: Receipt; progress: unknown[] }> {
    const result = await this.transport.request("operation.follow", { operationId, afterSequence }) as { receipt: unknown; progress: unknown[] };
    return { receipt: operationReceiptSchema.parse(result.receipt), progress: result.progress };
  }

  async run(
    input: Omit<Invocation, "invocationId">,
    options: { detach?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ receipt: Receipt; detached: boolean; progress: unknown[] }> {
    const accepted = await this.invoke(input);
    if (options.detach || options.signal?.aborted) {
      return { receipt: accepted, detached: true, progress: [] };
    }
    try {
      const followed = await this.follow(accepted.operationId);
      return { ...followed, detached: false };
    } catch (error) {
      // Disconnect and Ctrl+C never imply cancellation or a second invocation.
      if (options.signal?.aborted) return { receipt: accepted, detached: true, progress: [] };
      throw error;
    }
  }

  async cancel(operationId: string, expectedPhase: string): Promise<Receipt> {
    return operationReceiptSchema.parse(await this.transport.request("operation.cancel", { operationId, expectedPhase }));
  }
}

export type CliExit = "healthy" | "degraded" | "unavailable" | "incompatible" | "control-failure";
export interface LocalStatus {
  launcher: { state: "ready" | "degraded" | "stopped" | "circuit-open" | "recovery-only" | "incompatible"; attempts: number; cause?: string };
  daemon?: { freshness: "current" | "stale"; mode: "normal" | "recovery-only"; health: ReadonlyArray<{ scope: string; availability: string; freshness: "current" | "stale"; code: string }> };
}
export interface StatusProjection { readonly exit: CliExit; readonly human: string; readonly json: LocalStatus; }

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
