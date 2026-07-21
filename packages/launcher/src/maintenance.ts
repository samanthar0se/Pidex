import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { ChildBootstrapIdentity } from "../../local-control/src/child-bootstrap.js";
import type { ManagedProcess, ProcessPort } from "../../windows/src/ports.js";

export const MAINTENANCE_OPERATIONS = [
  "restore",
  "recovery",
  "migration",
  "reidentify",
] as const;
export type MaintenanceOperation = (typeof MAINTENANCE_OPERATIONS)[number];
export type PolicyOwnedOperation = "backup" | MaintenanceOperation;

const policyOwnedOperations: ReadonlySet<string> = new Set([
  "backup",
  ...MAINTENANCE_OPERATIONS,
]);

export function isPolicyOwnedOperation(operation: string): operation is PolicyOwnedOperation {
  return policyOwnedOperations.has(operation);
}

export function policyOwnerForOperation(
  operation: PolicyOwnedOperation,
): "daemon" | "maintenance" {
  return operation === "backup" ? "daemon" : "maintenance";
}

const stateSchema = z.strictObject({
  operationId: z.string().min(1),
  operation: z.enum(MAINTENANCE_OPERATIONS),
  state: z.enum(["launching", "running", "interrupted", "succeeded", "failed"]),
  processId: z.number().int().positive().optional(),
  authorityDisposition: z.literal("inspect-before-next-mutation").optional(),
});
type MaintenanceState = z.infer<typeof stateSchema>;

interface MaintenanceManifestSelection {
  instanceId: string;
  releaseId: string;
  localControlGeneration: number;
  maintenanceExecutable: string;
  workingDirectory: string;
}

interface BootstrapPort {
  /** The implementation writes the optional secret to a dedicated inherited handle. */
  issue(secret?: string): { handle: number; nonce: Buffer };
  authenticate(nonce: Uint8Array, identity: ChildBootstrapIdentity): void;
}

interface MaintenanceOptions {
  statePath: string;
  manifest: MaintenanceManifestSelection;
  daemon: { isStopped(): boolean };
  bootstrap: BootstrapPort;
  process: Pick<ProcessPort, "spawnContained">;
}

/** Launcher-owned gate for manifest-pinned, offline Authority maintenance. */
export class ContainedMaintenance {
  readonly #options: MaintenanceOptions;
  #state?: MaintenanceState;
  #nonce?: Buffer;
  #process?: ManagedProcess;

  constructor(options: MaintenanceOptions) {
    this.#options = options;
    if (existsSync(options.statePath)) {
      this.#state = stateSchema.parse(JSON.parse(readFileSync(options.statePath, "utf8")));
    }
  }

  async start(input: {
    operationId: string;
    operation: MaintenanceOperation;
    secret?: string;
  }): Promise<{ processId: number; nonce: Buffer }> {
    if (!this.#options.daemon.isStopped()) throw new Error("daemon-must-be-stopped");
    if (this.#state && (this.#state.state === "launching" || this.#state.state === "running")) {
      throw new Error("maintenance-already-active");
    }

    this.#write({ operationId: input.operationId, operation: input.operation, state: "launching" });
    const bootstrap = this.#options.bootstrap.issue(input.secret);
    const manifest = this.#options.manifest;
    try {
      this.#process = await this.#options.process.spawnContained({
        executable: manifest.maintenanceExecutable,
        cwd: manifest.workingDirectory,
        argv: ["--manifest-maintenance", input.operation, input.operationId],
        // Secrets are available only through bootstrap.handle, never argv/env/state.
        environment: {},
        bootstrapHandle: bootstrap.handle,
        endpoint: `\\\\.\\pipe\\pidex-${manifest.instanceId}-maintenance`,
        identity: {
          instanceId: manifest.instanceId,
          releaseId: manifest.releaseId,
          protocolGeneration: manifest.localControlGeneration,
          role: "maintenance",
        },
      });
      this.#nonce = bootstrap.nonce;
      this.#write({ ...this.#state!, state: "running", processId: this.#process.processId });
      return { processId: this.#process.processId, nonce: Buffer.from(bootstrap.nonce) };
    } catch (error) {
      this.#write({ ...this.#state!, state: "failed" });
      throw error;
    }
  }

  authenticate(nonce: Uint8Array, identity: ChildBootstrapIdentity): void {
    if (!this.#nonce || !this.#state || this.#state.state !== "running") {
      throw new Error("maintenance-not-running");
    }
    if (identity.processId !== this.#state.processId) throw new Error("maintenance-process-mismatch");
    this.#options.bootstrap.authenticate(nonce, identity);
  }

  /** Records only proved terminal evidence; uncertainty must use reconcile(). */
  complete(state: "succeeded" | "failed"): MaintenanceState {
    if (!this.#state || this.#state.state !== "running") {
      throw new Error("maintenance-not-running");
    }
    this.#write({ ...this.#state, state });
    this.#nonce = undefined;
    this.#process = undefined;
    return this.#state;
  }

  reconcile(): MaintenanceState | undefined {
    if (!this.#state) return undefined;
    if (this.#state.state !== "launching" && this.#state.state !== "running") return this.#state;
    this.#write({
      operationId: this.#state.operationId,
      operation: this.#state.operation,
      state: "interrupted",
      authorityDisposition: "inspect-before-next-mutation",
    });
    return this.#state;
  }

  #write(state: MaintenanceState): void {
    const parsed = stateSchema.parse(state);
    mkdirSync(dirname(this.#options.statePath), { recursive: true });
    const temporary = `${this.#options.statePath}.new`;
    writeFileSync(temporary, JSON.stringify(parsed), { mode: 0o600 });
    const descriptor = openSync(temporary, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, this.#options.statePath);
    this.#state = parsed;
  }
}
