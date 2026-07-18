import { randomUUID } from "node:crypto";

export type ModuleId = `${string}.${string}`;
export type QualifiedName = `${ModuleId}/${string}`;
export type ResourceId = `${QualifiedName}:${string}`;

const MODULE_ID_PATTERN = /^([a-z][a-z0-9-]*\.)+[a-z][a-z0-9-]*$/;

export type UiSlot =
  | "destination"
  | "detail"
  | "action"
  | "status"
  | "diagnostic"
  | "timeline-renderer"
  | "interaction-renderer";

export interface StorageMigration {
  from: number;
  to: number;
  migrate(): void;
}

export interface StorageFamily {
  name: QualifiedName;
  sqliteNamespace: string;
  blobKinds: readonly QualifiedName[];
  migrations: readonly StorageMigration[];
  checkIntegrity(): void;
  enumerateBackupReferences(): readonly string[];
  applyRetention(): void;
  validateRestore(): void;
}

export interface ResourceKindContribution {
  name: QualifiedName;
  scope: "host" | "project" | "workspace";
}

export interface UiContribution {
  id: QualifiedName;
  slot: UiSlot;
  capability?: QualifiedName;
  projectionType: QualifiedName;
}

export interface ModuleManifest {
  id: ModuleId;
  version: string;
  hostCompatibility: { major: number };
  resourceKinds: readonly ResourceKindContribution[];
  protocolFamilies: readonly QualifiedName[];
  capabilities: readonly QualifiedName[];
  storage: readonly StorageFamily[];
  diagnostics: readonly QualifiedName[];
  lifecycleServices: readonly QualifiedName[];
  ui: readonly UiContribution[];
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

export interface ModuleCommandChange {
  kind: QualifiedName;
  target: ResourceId;
  revision: number;
}

export interface ModuleCommandResult<T = unknown> {
  receipt: string;
  cursor: string;
  revision: number;
  value: T;
  changes: readonly ModuleCommandChange[];
}

export interface PreservedResource {
  kind: QualifiedName;
  provenance: string;
  bytes: Uint8Array;
}

export interface ModuleRuntime {
  commands: Readonly<Record<string, (payload: unknown) => unknown>>;
}

export class ModuleRegistrationError extends Error {}

/** Registration and dispatch boundary for bundled, trusted feature modules. */
export class ModuleKernel {
  readonly manifests = new Map<ModuleId, Readonly<ModuleManifest>>();
  readonly unavailableKinds = new Set<QualifiedName>();
  readonly preserved = new Map<ResourceId, PreservedResource>();
  readonly #runtimes = new Map<ModuleId, ModuleRuntime>();
  readonly #contributionNames = new Set<QualifiedName>();
  readonly #commandReceipts = new Map<string, ModuleCommandResult>();
  #isReady = false;
  #inFlight = 0;

  constructor(readonly hostMajor: number, readonly maximumInFlight = 32) {}

  register(manifest: ModuleManifest, runtime: ModuleRuntime): void {
    if (this.#isReady) {
      throw new ModuleRegistrationError(
        "registration is closed after readiness",
      );
    }
    if (!MODULE_ID_PATTERN.test(manifest.id)) {
      throw new ModuleRegistrationError("module identity must be namespaced");
    }
    if (this.manifests.has(manifest.id)) {
      throw new ModuleRegistrationError(`duplicate module ${manifest.id}`);
    }
    if (manifest.hostCompatibility.major !== this.hostMajor) {
      throw new ModuleRegistrationError("incompatible host");
    }

    const contributionNames = [
      ...manifest.resourceKinds.map(resourceKind => resourceKind.name),
      ...manifest.protocolFamilies,
      ...manifest.capabilities,
      ...manifest.storage.map(storageFamily => storageFamily.name),
      ...manifest.storage.flatMap(storageFamily => storageFamily.blobKinds),
      ...manifest.diagnostics,
      ...manifest.lifecycleServices,
      ...manifest.ui.map(uiContribution => uiContribution.id),
    ];
    for (const contributionName of contributionNames) {
      if (
        !contributionName.startsWith(`${manifest.id}/`) ||
        this.#contributionNames.has(contributionName)
      ) {
        throw new ModuleRegistrationError(
          `invalid or colliding contribution ${contributionName}`,
        );
      }
    }

    for (const storageFamily of manifest.storage) {
      const namespacePrefix = `${manifest.id.replaceAll(".", "_")}__`;
      if (!storageFamily.sqliteNamespace.startsWith(namespacePrefix)) {
        throw new ModuleRegistrationError(
          "SQLite namespace is not module-owned",
        );
      }

      let migrationVersion = 0;
      for (const migration of storageFamily.migrations) {
        if (
          migration.from !== migrationVersion ||
          migration.to !== migrationVersion + 1
        ) {
          throw new ModuleRegistrationError(
            "migrations must be deterministic and contiguous",
          );
        }
        migrationVersion = migration.to;
      }
    }

    contributionNames.forEach(contributionName =>
      this.#contributionNames.add(contributionName),
    );
    this.manifests.set(manifest.id, Object.freeze(manifest));
    this.#runtimes.set(manifest.id, runtime);
  }

  ready(): void {
    this.#isReady = true;
  }

  opaqueId(kind: QualifiedName): ResourceId {
    if (!this.#contributionNames.has(kind)) {
      throw new Error("unknown resource kind");
    }
    return `${kind}:${randomUUID()}`;
  }

  preserveUnavailable(
    id: ResourceId,
    kind: QualifiedName,
    provenance: string,
    bytes: Uint8Array,
  ): void {
    this.unavailableKinds.add(kind);
    this.preserved.set(id, { kind, provenance, bytes: bytes.slice() });
  }

  async dispatch(
    command: ModuleCommand,
    authenticatedDeviceId: string,
  ): Promise<ModuleCommandResult> {
    if (!this.#isReady) {
      throw new Error("kernel is not ready");
    }
    if (command.deviceId !== authenticatedDeviceId) {
      throw new Error("authentication mismatch");
    }
    if (this.unavailableKinds.has(resourceKindFromId(command.target))) {
      throw new Error("resource kind unavailable");
    }

    const receipt = `${command.deviceId}/${command.commandId}`;
    const previousResult = this.#commandReceipts.get(receipt);
    if (previousResult) {
      return previousResult;
    }
    if (this.#inFlight >= this.maximumInFlight) {
      throw new Error("backpressure");
    }

    const moduleId = moduleIdFromQualifiedName(command.kind);
    const manifest = this.manifests.get(moduleId);
    const handler = this.#runtimes.get(moduleId)?.commands[command.kind];
    if (!manifest?.capabilities.includes(command.capability) || !handler) {
      throw new Error("unsupported command or capability");
    }
    if (!command.target.startsWith(`${moduleId}/`)) {
      throw new Error("cross-module target");
    }

    this.#inFlight += 1;
    try {
      const revision = command.observedRevision + 1;
      const result: ModuleCommandResult = {
        receipt,
        cursor: `module:${this.#commandReceipts.size + 1}`,
        revision,
        value: await handler(command.payload),
        changes: [
          {
            kind: resourceKindFromId(command.target),
            target: command.target,
            revision,
          },
        ],
      };
      this.#commandReceipts.set(result.receipt, result);
      return result;
    } finally {
      this.#inFlight -= 1;
    }
  }

  /**
   * Workers receive no store/runtime handle; they can only submit this
   * validated envelope to daemon dispatch.
   */
  dispatchWorkerRequest(
    request: WorkerActionRequest,
    authenticatedDeviceId: string,
  ): Promise<ModuleCommandResult> {
    if (
      !request.correlationId ||
      !request.sessionId ||
      request.workerGeneration < 1
    ) {
      throw new Error("invalid worker request");
    }
    return this.dispatch(request.command, authenticatedDeviceId);
  }
}

function moduleIdFromQualifiedName(name: QualifiedName): ModuleId {
  return name.slice(0, name.indexOf("/")) as ModuleId;
}

function resourceKindFromId(id: ResourceId): QualifiedName {
  return id.slice(0, id.lastIndexOf(":")) as QualifiedName;
}

export const futureWorkspaceContracts = Object.freeze({
  terminalAndManagedProcess: "separate-host-owned-job",
  sessionRelationship: "provenance-only",
  electron: "device-client",
  tunnel: "transport-adapter",
  thirdPartyLoader: false,
} as const);
