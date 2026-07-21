import type { WindowsPlatformError } from "./errors.js";
import type {
  CertificateIntegration, FirewallIntegration, IntegrationInspection, TaskIntegration,
} from "./integrations.js";

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
  snapshotPrivateInterfaces(): Promise<unknown>;
  observePrivateInterfaces(): Promise<ManagedWindowsResource>;
  openAdvertisement(input: unknown): Promise<ManagedWindowsResource>;
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
  inspectPath(input: { path: string }): Promise<unknown>;
  observeTopology(): Promise<ManagedWindowsResource>;
}

export interface DiagnosticsPort {
  writeEvent(input: unknown): Promise<boolean>;
}
