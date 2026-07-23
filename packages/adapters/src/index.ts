export interface Clock {
  now(): number;
}

export interface PiProbeRequest {
  protocolGeneration: 1;
  sdkGeneration: string;
}

export interface PiProbeResult {
  protocolGeneration: number;
  sdkGeneration: string;
  capabilities: Array<string | PiSdkCapability>;
}

export interface PiInputImage {
  type: "image";
  data: string;
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
}

/** Data-only SDK semantics. No SDK model or runtime object may cross this seam. */
export interface PiSdkCapability {
  id: string;
  version: number;
  constraints?: PiSdkCapabilityConstraints;
}

export interface PiSdkCapabilityConstraints {
  values?: string[];
  maximumBytes?: number;
}

export type PiSteeringReceiver = (
  text: string,
  images?: PiInputImage[],
) => Promise<void>;

export interface PiExecuteRequest {
  sessionId: string;
  prompt: string;
  /** Canonical Project checkout or Workspace path permanently bound to this Session. */
  cwd?: string;
  images?: PiInputImage[];
  projectTrust: true;
  resourceLoader: "public";
  /** Receives schema-shaped runtime facts; SDK objects never cross this seam. */
  onTimelineEvent?: (event: PiTimelineEvent) => void;
  /** Receives bounded, data-only UI effects. They never become Pi responses. */
  onPresentationEffect?: (effect: PiPresentationEffect) => void;
  /** Resolves only when the exact Host-owned request has been answered. */
  onInteraction?: (
    request: PiInteractionRequest,
  ) => Promise<PiInteractionResult>;
  /** The runtime registers the receiver belonging to this exact execution. */
  registerSteeringReceiver?: (receiver: PiSteeringReceiver) => void;
  /** Cooperative cancellation for this exact execution. Pi/tool cleanup settles before execute returns. */
  signal?: AbortSignal;
}

export type PiPresentationEffect =
  | { type: "notification"; level: "info" | "warning" | "error"; text: string }
  | { type: "status"; key: string; text: string | null }
  | { type: "widget"; key: string; text: string | null }
  | { type: "title"; text: string | null }
  | { type: "editor-text"; text: string };

export type PiInteractionRequest =
  | {
      correlationId: string;
      kind: "select";
      message: string;
      options: string[];
      provenance?: string;
      timeoutMs?: number;
    }
  | {
      correlationId: string;
      kind: "confirm";
      message: string;
      defaultValue?: boolean;
      provenance?: string;
      timeoutMs?: number;
    }
  | {
      correlationId: string;
      kind: "input" | "editor";
      message: string;
      defaultValue?: string;
      provenance?: string;
      timeoutMs?: number;
    };

export type PiInteractionResult =
  | { dismissed: false; value: string | boolean }
  | { dismissed: true };

export type PiTimelineEvent =
  | { type: "assistant.delta"; text: string }
  | { type: "tool.started"; toolCallId: string; name: string }
  | { type: "tool.completed"; toolCallId: string; name: string; text: string };

export interface PiExecuteResult {
  text: string;
  checkpoint: string;
}

export interface PiAdapter {
  readonly kind: "real" | "deterministic";
  /** Pidex's public SDK seam. Implementations must use Pi's resource loader. */
  probe?(request: PiProbeRequest): Promise<PiProbeResult>;
  execute?(request: PiExecuteRequest): Promise<PiExecuteResult>;
  /** Flushes the private Pi artifact and proves the returned checkpoint is stable. */
  flushCheckpoint?(sessionId: string, checkpoint: string): Promise<string>;
  /** Creates a private child artifact from a checkpoint validated by this runtime. */
  forkCheckpoint?(
    parentSessionId: string,
    checkpoint: string,
    childSessionId: string,
  ): Promise<PiForkBootstrap>;
  /** Copy-migrates an artifact owned by an older pinned Pi runtime. */
  migrateArtifact?(
    request: PiArtifactMigrationRequest,
  ): Promise<PiArtifactMigrationResult>;
  /** Releases one Session's Pi runtime after sleep or archival. */
  closeSession?(sessionId: string): Promise<void>;
  /** Releases all Pi runtimes during Host shutdown. */
  close?(): Promise<void>;
}

/** A fresh contained bootstrap generation owning a verified child genesis. */
export interface PiForkBootstrap {
  /** Imports, publishes, and validates the child-owned genesis checkpoint. */
  publish(): Promise<string>;
  /** Terminates the bootstrap generation and all of its descendants. */
  close(): Promise<void>;
}

export interface PiArtifactMigrationRequest {
  sessionId: string;
  sourcePath: string;
  destinationPath: string;
  sourcePidexVersion: string;
  sourcePiVersion: string;
  targetPidexVersion: string;
  targetPiVersion: string;
}

export interface PiArtifactMigrationResult {
  checkpoint: string;
}

export interface NetworkAdapter {
  beforeSend(): void;
}

export interface StorageFaultAdapter {
  beforeCommit(): void;
}

export interface WindowsPlatformAdapter {
  readonly kind: "windows" | "deterministic";
  protectForCurrentUser(cleartext: Buffer): Buffer;
  unprotectForCurrentUser(envelope: Buffer): Buffer;
  restrictToCurrentUser(path: string): void;
  registerLogonTask(command: string, args: readonly string[]): void;
  /**
   * Creates a Session worker suspended, assigns it to a fresh non-breakaway
   * kill-on-close Job, and resumes it only after assignment succeeds. The
   * native implementation must not return a handle for an uncontained worker.
   */
  createContainedSessionWorker(sessionId: string): SessionJob;
  /** Returns only coarse volume facts; callers must not publish the resolved path or device. */
  classifyStorage(path: string): Promise<StorageVolumeFacts>;
  /** Classifies a root for refreshed recovery-oriented coverage reporting. */
  classifyStorageRoot(path: string): Promise<StorageClassification>;
  /** Reports volume topology changes; the returned function removes the observer. */
  observeVolumeChanges(listener: () => void): () => void;
}

export interface StorageVolumeFacts {
  fileSystem?: string;
  driveType?:
    | "fixed"
    | "removable"
    | "remote"
    | "optical"
    | "ramdisk"
    | "unknown";
}

export interface StorageClassification {
  fileSystem: string;
  driveType: "fixed" | "remote" | "removable" | "unknown";
}

export interface SessionJob {
  readonly sessionId: string;
  /** Terminates the worker and every descendant still held by this Job. */
  terminate(): void;
  /** Closes the kill-on-close Job. Safe to call repeatedly. */
  close(): void;
}

export class SessionContainmentError extends Error {
  readonly code = "session-containment-setup-failed" as const;

  constructor(detail: string, options?: ErrorOptions) {
    super(detail, options);
    this.name = "SessionContainmentError";
  }
}

export interface HostAdapters {
  clock: Clock;
  pi: PiAdapter;
  network: NetworkAdapter;
  storage: StorageFaultAdapter;
  windows: WindowsPlatformAdapter;
}

export type AdapterMode = "deterministic";

const DETERMINISTIC_DPAPI_HEADER = Buffer.from("PIDEX-DPAPI-V1\0");

export function adaptersFor(mode: AdapterMode): HostAdapters {
  if (mode !== "deterministic") {
    throw new Error("legacy adapters are restricted to deterministic development evidence");
  }
  return {
    clock: { now: () => 1_700_000_000_000 },
    pi: deterministicPiAdapter(),
    network: { beforeSend() {} },
    storage: { beforeCommit() {} },
    windows: deterministicWindowsAdapter(),
  };
}

function deterministicPiAdapter(): PiAdapter {
  return {
    kind: "deterministic",
    probe: async request => ({
      ...request,
      capabilities: [
        { id: "run.execute", version: 1 },
        { id: "checkpoint.durable", version: 1 },
        {
          id: "model.select",
          version: 1,
          constraints: { values: ["deterministic"] },
        },
        {
          id: "mode.select",
          version: 1,
          constraints: { values: ["agent"] },
        },
        {
          id: "input.text",
          version: 1,
          constraints: { maximumBytes: 100_000 },
        },
        {
          id: "input.image",
          version: 1,
          constraints: { maximumBytes: 8 * 1024 * 1024 },
        },
        { id: "runtime.cancel", version: 1 },
        { id: "runtime.steer", version: 1 },
        { id: "presentation.notification", version: 1 },
        { id: "presentation.status", version: 1 },
        { id: "presentation.widget", version: 1 },
        { id: "presentation.title", version: 1 },
        { id: "presentation.editor-text", version: 1 },
        {
          id: "interaction.basic",
          version: 1,
          constraints: { maximumBytes: 100_000 },
        },
      ],
    }),
    execute: async request => ({
      text: `Deterministic Pi response: ${request.prompt}`,
      checkpoint: `checkpoint:${request.sessionId}`,
    }),
    flushCheckpoint: async (_sessionId, checkpoint) => checkpoint,
    forkCheckpoint: async (_parentSessionId, checkpoint, childSessionId) => ({
      publish: async () => `${checkpoint}:genesis:${childSessionId}`,
      close: async () => {},
    }),
  };
}

function deterministicWindowsAdapter(): WindowsPlatformAdapter {
  return {
    kind: "deterministic",
    protectForCurrentUser: cleartext =>
      Buffer.concat([DETERMINISTIC_DPAPI_HEADER, cleartext]),
    unprotectForCurrentUser: envelope =>
      envelope.subarray(DETERMINISTIC_DPAPI_HEADER.length),
    restrictToCurrentUser() {},
    registerLogonTask() {},
    createContainedSessionWorker: sessionId => ({
      sessionId,
      terminate() {},
      close() {},
    }),
    classifyStorage: async () => ({ fileSystem: "NTFS", driveType: "fixed" }),
    classifyStorageRoot: async () => ({
      fileSystem: "NTFS",
      driveType: "fixed",
    }),
    observeVolumeChanges: () => () => {},
  };
}
