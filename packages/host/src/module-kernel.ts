import { randomUUID } from "node:crypto";

export type ModuleId = `${string}.${string}`;
export type QualifiedName = `${ModuleId}/${string}`;
export type ResourceId = `${QualifiedName}:${string}`;

export type UiSlot =
  | "destination"
  | "detail"
  | "action"
  | "status"
  | "diagnostic"
  | "timeline-renderer"
  | "interaction-renderer";

export interface StorageFamily {
  name: QualifiedName;
  sqliteNamespace: string;
  blobKinds: QualifiedName[];
  migrations: ReadonlyArray<{ from: number; to: number; migrate(): void }>;
  checkIntegrity(): void;
  enumerateBackupReferences(): readonly string[];
  applyRetention(): void;
  validateRestore(): void;
}

export interface ModuleManifest {
  id: ModuleId;
  version: string;
  hostCompatibility: { major: number };
  resourceKinds: ReadonlyArray<{
    name: QualifiedName;
    scope: "host" | "project" | "workspace";
  }>;
  protocolFamilies: readonly QualifiedName[];
  capabilities: readonly QualifiedName[];
  storage: readonly StorageFamily[];
  diagnostics: readonly QualifiedName[];
  lifecycleServices: readonly QualifiedName[];
  ui: ReadonlyArray<{
    id: QualifiedName;
    slot: UiSlot;
    capability?: QualifiedName;
    projectionType: QualifiedName;
  }>;
}

export interface ModuleCommand<T = unknown> {
  commandId: string;
  deviceId: string;
  kind: QualifiedName;
  target: ResourceId;
  capability: QualifiedName;
  observedRevision: number;
  payload: T;
}

export interface WorkerActionRequest<T = unknown> {
  correlationId: string;
  sessionId: string;
  workerGeneration: number;
  command: ModuleCommand<T>;
}

export interface ModuleCommandResult<T = unknown> {
  receipt: string;
  cursor: string;
  revision: number;
  value: T;
  changes: readonly { kind: QualifiedName; target: ResourceId; revision: number }[];
}

export interface ModuleRuntime {
  commands: Readonly<Record<string, (payload: unknown) => unknown>>;
}

export class ModuleRegistrationError extends Error {}

/** Registration and dispatch boundary for bundled, trusted feature modules. */
export class ModuleKernel {
  readonly manifests = new Map<ModuleId, Readonly<ModuleManifest>>();
  readonly unavailableKinds = new Set<QualifiedName>();
  readonly preserved = new Map<ResourceId, { kind: QualifiedName; provenance: string; bytes: Uint8Array }>();
  #runtimes = new Map<ModuleId, ModuleRuntime>();
  #names = new Set<string>();
  #receipts = new Map<string, ModuleCommandResult>();
  #ready = false;
  #inFlight = 0;

  constructor(readonly hostMajor: number, readonly maximumInFlight = 32) {}

  register(manifest: ModuleManifest, runtime: ModuleRuntime): void {
    if (this.#ready) throw new ModuleRegistrationError("registration is closed after readiness");
    if (!/^([a-z][a-z0-9-]*\.)+[a-z][a-z0-9-]*$/.test(manifest.id))
      throw new ModuleRegistrationError("module identity must be namespaced");
    if (this.manifests.has(manifest.id)) throw new ModuleRegistrationError(`duplicate module ${manifest.id}`);
    if (manifest.hostCompatibility.major !== this.hostMajor) throw new ModuleRegistrationError("incompatible host");
    const names = [
      ...manifest.resourceKinds.map(x => x.name), ...manifest.protocolFamilies,
      ...manifest.capabilities, ...manifest.storage.map(x => x.name),
      ...manifest.storage.flatMap(x => x.blobKinds), ...manifest.diagnostics,
      ...manifest.lifecycleServices, ...manifest.ui.map(x => x.id),
    ];
    for (const name of names) {
      if (!name.startsWith(`${manifest.id}/`) || this.#names.has(name))
        throw new ModuleRegistrationError(`invalid or colliding contribution ${name}`);
    }
    for (const family of manifest.storage) {
      if (!family.sqliteNamespace.startsWith(manifest.id.replaceAll(".", "_") + "__"))
        throw new ModuleRegistrationError("SQLite namespace is not module-owned");
      let version = 0;
      for (const migration of family.migrations) {
        if (migration.from !== version || migration.to !== version + 1)
          throw new ModuleRegistrationError("migrations must be deterministic and contiguous");
        version = migration.to;
      }
    }
    names.forEach(name => this.#names.add(name));
    this.manifests.set(manifest.id, Object.freeze(manifest));
    this.#runtimes.set(manifest.id, runtime);
  }

  ready(): void { this.#ready = true; }

  opaqueId(kind: QualifiedName): ResourceId {
    if (!this.#names.has(kind)) throw new Error("unknown resource kind");
    return `${kind}:${randomUUID()}`;
  }

  preserveUnavailable(id: ResourceId, kind: QualifiedName, provenance: string, bytes: Uint8Array): void {
    this.unavailableKinds.add(kind);
    this.preserved.set(id, { kind, provenance, bytes: bytes.slice() });
  }

  async dispatch(command: ModuleCommand, authenticatedDeviceId: string): Promise<ModuleCommandResult> {
    if (!this.#ready) throw new Error("kernel is not ready");
    if (command.deviceId !== authenticatedDeviceId) throw new Error("authentication mismatch");
    if (this.unavailableKinds.has(resourceKind(command.target))) throw new Error("resource kind unavailable");
    const replay = this.#receipts.get(`${command.deviceId}/${command.commandId}`);
    if (replay) return replay;
    if (this.#inFlight >= this.maximumInFlight) throw new Error("backpressure");
    const moduleId = moduleOf(command.kind);
    const manifest = this.manifests.get(moduleId);
    const handler = this.#runtimes.get(moduleId)?.commands[command.kind];
    if (!manifest?.capabilities.includes(command.capability) || !handler) throw new Error("unsupported command or capability");
    if (!command.target.startsWith(`${moduleId}/`)) throw new Error("cross-module target");
    this.#inFlight++;
    try {
      const revision = command.observedRevision + 1;
      const result: ModuleCommandResult = {
        receipt: `${command.deviceId}/${command.commandId}`,
        cursor: `module:${this.#receipts.size + 1}`,
        revision,
        value: await handler(command.payload),
        changes: [{ kind: resourceKind(command.target), target: command.target, revision }],
      };
      this.#receipts.set(result.receipt, result);
      return result;
    } finally { this.#inFlight--; }
  }

  /** Workers receive no store/runtime handle; they can only submit this validated envelope to daemon dispatch. */
  dispatchWorkerRequest(request: WorkerActionRequest, authenticatedDeviceId: string) {
    if (!request.correlationId || !request.sessionId || request.workerGeneration < 1) throw new Error("invalid worker request");
    return this.dispatch(request.command, authenticatedDeviceId);
  }
}

function moduleOf(name: QualifiedName): ModuleId { return name.slice(0, name.indexOf("/")) as ModuleId; }
function resourceKind(id: ResourceId): QualifiedName { return id.slice(0, id.lastIndexOf(":")) as QualifiedName; }

export const futureWorkspaceContracts = Object.freeze({
  terminalAndManagedProcess: "separate-host-owned-job",
  sessionRelationship: "provenance-only",
  electron: "device-client",
  tunnel: "transport-adapter",
  thirdPartyLoader: false,
} as const);
