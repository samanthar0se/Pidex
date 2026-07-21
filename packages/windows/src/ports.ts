import type { WindowsPlatformError } from "./errors.js";

export interface ManagedWindowsResource<TFault = WindowsPlatformError> {
  readonly lateFault: Promise<TFault>;
  close(): Promise<void>;
}

/** Contracts are asynchronous even where a Windows API completes immediately. */
export interface InstallationPort {
  inspectCertificate(input: unknown): Promise<unknown>;
  installCertificate(input: unknown): Promise<void>;
  removeCertificate(input: unknown): Promise<void>;
  inspectTask(input: unknown): Promise<unknown>;
  registerTask(input: unknown): Promise<void>;
  removeTask(input: unknown): Promise<void>;
}

export interface NetworkPort {
  snapshotPrivateInterfaces(): Promise<unknown>;
  observePrivateInterfaces(): Promise<ManagedWindowsResource>;
  openAdvertisement(input: unknown): Promise<ManagedWindowsResource>;
}

export interface FirewallPort {
  inspectRule(input: unknown): Promise<unknown>;
  ensureRule(input: unknown): Promise<void>;
  removeRule(input: unknown): Promise<void>;
}

export interface ProcessPort {
  spawnContained(input: unknown): Promise<ManagedWindowsResource>;
}

export interface StoragePort {
  inspectPath(input: { path: string }): Promise<StoragePathInspection>;
  observeTopology(): Promise<ManagedWindowsResource>;
}

export type StorageDriveType = "fixed" | "removable" | "remote" | "optical" | "ramdisk" | "unknown";
export interface StoragePathInspection {
  coverage: "covered" | "outside-boundary" | "indeterminate";
  fileSystem?: string;
  driveType: StorageDriveType;
}

export interface DiagnosticsPort {
  writeEvent(input: { code: string; severity: "information" | "warning" | "error" }): Promise<boolean>;
}
