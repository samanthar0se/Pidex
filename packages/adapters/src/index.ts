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

export type PiSteeringReceiver = (text: string) => Promise<void>;

export interface PiExecuteRequest {
  sessionId: string;
  prompt: string;
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
  ): Promise<string>;
  /** Copy-migrates an artifact owned by an older pinned Pi runtime. */
  migrateArtifact?(
    request: PiArtifactMigrationRequest,
  ): Promise<PiArtifactMigrationResult>;
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
  trustCurrentUserCertificate(path: string): void;
  registerLogonTask(command: string, args: readonly string[]): void;
  privateInterfaces(): readonly PrivateInterface[];
  advertisePidex(advertisement: PidexAdvertisement): () => void;
  inspectPidexFirewall(port: number): FirewallHealth;
  applyPidexFirewall(operation: FirewallOperation): void;
  writeCoarseEvent(event: CoarseWindowsEvent): void;
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

export interface PrivateInterface {
  name: string;
  addresses: readonly string[];
  profile: "private";
}

export interface PidexAdvertisement {
  service: "_pidex._tcp.local";
  hostname: string;
  port: number;
  interfaces: readonly PrivateInterface[];
  txt: {
    location: string;
    label: string;
    version: string;
    fingerprint: string;
  };
}

export type FirewallHealth =
  | { state: "healthy" }
  | {
      state: "missing" | "disabled" | "broadened" | "unverifiable";
      detail: string;
    };

export type FirewallOperation =
  | { operation: "ensure-private-rule"; port: number }
  | { operation: "remove-rule" };

export interface CoarseWindowsEvent {
  severity: "error";
  code: "PIDEX_FIREWALL_DEGRADED";
  detail: string;
}

/** Sole input boundary for the elevated helper; rejects arguments and extra fields. */
export function executePidexFirewallOperation(
  windows: WindowsPlatformAdapter,
  input: unknown,
): void {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid Pidex Firewall operation");
  }

  const value = input as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(",");

  if (value.operation === "remove-rule" && keys === "operation") {
    windows.applyPidexFirewall({ operation: "remove-rule" });
    return;
  }

  if (
    value.operation === "ensure-private-rule" &&
    keys === "operation,port" &&
    isValidFirewallPort(value.port)
  ) {
    windows.applyPidexFirewall({
      operation: "ensure-private-rule",
      port: Number(value.port),
    });
    return;
  }

  throw new Error("Invalid Pidex Firewall operation");
}

function isValidFirewallPort(port: unknown): boolean {
  return (
    Number.isInteger(port) && Number(port) >= 1 && Number(port) <= 65_535
  );
}

export interface HostAdapters {
  clock: Clock;
  pi: PiAdapter;
  network: NetworkAdapter;
  storage: StorageFaultAdapter;
  windows: WindowsPlatformAdapter;
}

export type AdapterMode = "product" | "deterministic";

const DETERMINISTIC_DPAPI_HEADER = Buffer.from("PIDEX-DPAPI-V1\0");

export function adaptersFor(mode: AdapterMode = "product"): HostAdapters {
  const deterministic = mode === "deterministic";
  const windows = deterministic
    ? deterministicWindowsAdapter()
    : productWindowsAdapter();

  return {
    clock: {
      now: () => (deterministic ? 1_700_000_000_000 : Date.now()),
    },
    pi: deterministic ? deterministicPiAdapter() : { kind: "real" },
    network: { beforeSend() {} },
    storage: { beforeCommit() {} },
    windows,
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
    forkCheckpoint: async (_parentSessionId, checkpoint) => checkpoint,
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
    trustCurrentUserCertificate() {},
    registerLogonTask() {},
    privateInterfaces: () => [
      {
        name: "deterministic-private",
        addresses: ["192.168.50.4"],
        profile: "private",
      },
    ],
    advertisePidex: () => () => {},
    inspectPidexFirewall: () => ({ state: "healthy" }),
    applyPidexFirewall() {},
    writeCoarseEvent() {},
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

function productWindowsAdapter(): WindowsPlatformAdapter {
  if (process.platform !== "win32") {
    throw new Error("The product Windows adapter requires Windows");
  }

  // Native operations are deliberately concentrated here. The packaged Windows
  // build supplies the signed native bridge; no privileged daemon is required.
  return {
    kind: "windows",
    protectForCurrentUser() {
      throw new Error("Pidex Windows native DPAPI bridge is not bundled");
    },
    unprotectForCurrentUser() {
      throw new Error("Pidex Windows native DPAPI bridge is not bundled");
    },
    restrictToCurrentUser() {
      throw new Error("Pidex Windows native ACL bridge is not bundled");
    },
    trustCurrentUserCertificate() {
      throw new Error("Pidex Windows certificate bridge is not bundled");
    },
    registerLogonTask() {
      throw new Error("Pidex Windows Task Scheduler bridge is not bundled");
    },
    privateInterfaces() {
      throw new Error("Pidex Windows network-profile bridge is not bundled");
    },
    advertisePidex() {
      throw new Error("Pidex Windows mDNS bridge is not bundled");
    },
    inspectPidexFirewall() {
      return {
        state: "unverifiable",
        detail: "Windows Firewall bridge is not bundled",
      };
    },
    applyPidexFirewall(operation) {
      if (
        operation.operation !== "ensure-private-rule" &&
        operation.operation !== "remove-rule"
      ) {
        throw new Error("Invalid privileged operation");
      }
      throw new Error("Pidex Windows Firewall bridge is not bundled");
    },
    writeCoarseEvent() {},
    createContainedSessionWorker() {
      // The packaged native bridge uses CREATE_SUSPENDED, a Job configured
      // with KILL_ON_JOB_CLOSE and no breakaway flags, AssignProcessToJobObject,
      // then ResumeThread. Never fall back to an escapable child.
      throw new SessionContainmentError(
        "Pidex Windows Session Job bridge is not bundled",
      );
    },
    async classifyStorage() {
      throw new Error("Pidex Windows volume classification bridge is not bundled");
    },
    async classifyStorageRoot() {
      throw new Error(
        "Pidex Windows storage classification bridge is not bundled",
      );
    },
    observeVolumeChanges() {
      return () => {};
    },
  };
}
