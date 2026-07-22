import type { WindowsPlatformError } from "./errors.js";
import type { StoragePathInspection } from "./storage.js";

export type { StorageDriveType, StoragePathInspection } from "./storage.js";

export interface ManagedWindowsResource<TFault = WindowsPlatformError> {
  readonly lateFault: Promise<TFault>;
  close(): Promise<void>;
}

/** Contracts are asynchronous even where a Windows API completes immediately. */
export interface InstallationPort {
}

export interface ProcessPort {
  spawnContained(input: ContainedProcessRequest): Promise<ManagedProcess>;
}

export interface ContainedProcessRequest {
  readonly executable: string;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly bootstrapHandle: number;
  readonly endpoint: string;
  readonly identity: {
    readonly instanceId: string;
    readonly releaseId: string;
    readonly protocolGeneration: number;
    readonly role: "daemon" | "worker" | "maintenance" | "tool";
  };
}

export interface ManagedProcess extends ManagedWindowsResource {
  readonly processId: number;
}

export interface StoragePort {
  inspectPath(input: { path: string }): Promise<StoragePathInspection>;
  observeTopology(): Promise<ManagedWindowsResource>;
}

export interface DiagnosticsPort {
  writeEvent(input: { code: string; severity: "information" | "warning" | "error" }): Promise<boolean>;
}
