import type { WindowsPlatformError } from "./errors.js";
import type {
  CertificateIntegration,
  FirewallIntegration,
  IntegrationInspection,
  TaskIntegration,
} from "./integrations.js";
import type { StoragePathInspection } from "./storage.js";

export type { StorageDriveType, StoragePathInspection } from "./storage.js";

export interface ManagedWindowsResource<TFault = WindowsPlatformError> {
  readonly lateFault: Promise<TFault>;
  close(): Promise<void>;
}

/** Contracts are asynchronous even where a Windows API completes immediately. */
export interface InstallationPort {
  inspectCertificate(input: CertificateIntegration): Promise<IntegrationInspection>;
  ensureCertificate(input: CertificateIntegration): Promise<{ changed: boolean; inspection: IntegrationInspection }>;
  removeCertificate(input: CertificateIntegration): Promise<void>;
  inspectTask(input: TaskIntegration): Promise<IntegrationInspection>;
  ensureTask(input: TaskIntegration): Promise<{ changed: boolean; inspection: IntegrationInspection }>;
  removeTask(input: TaskIntegration): Promise<void>;
}

export interface NetworkPort {
  snapshotPrivateInterfaces(): Promise<readonly PrivateNetworkInterface[]>;
  observePrivateInterfaces(
    listener: (snapshot: readonly PrivateNetworkInterface[]) => void | Promise<void>,
  ): Promise<ManagedWindowsResource>;
  openAdvertisement(input: PidexDnsSdAdvertisement): Promise<ManagedWindowsResource>;
}

export interface PrivateNetworkInterface {
  readonly id: string;
  readonly name: string;
  readonly addresses: readonly string[];
  readonly profile: "private";
}

export interface PidexDnsSdAdvertisement {
  readonly service: "_pidex._tcp.local";
  readonly hostname: string;
  readonly port: number;
  readonly interfaces: readonly PrivateNetworkInterface[];
  readonly txt: {
    readonly location: string;
    readonly label: string;
    readonly version: string;
    readonly fingerprint: string;
  };
}

export interface FirewallPort {
  inspectCanonicalRule(input: FirewallIntegration): Promise<IntegrationInspection>;
  ensureCanonicalRule(input: FirewallIntegration): Promise<{ changed: boolean; inspection: IntegrationInspection }>;
  removeCanonicalRule(input: FirewallIntegration): Promise<void>;
}

export interface ProcessPort {
  spawnContained(input: unknown): Promise<ManagedWindowsResource>;
}

export interface StoragePort {
  inspectPath(input: { path: string }): Promise<StoragePathInspection>;
  observeTopology(): Promise<ManagedWindowsResource>;
}

export interface DiagnosticsPort {
  writeEvent(input: { code: string; severity: "information" | "warning" | "error" }): Promise<boolean>;
}
