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
  inspectRule(input: unknown): Promise<unknown>;
  ensureRule(input: unknown): Promise<void>;
  removeRule(input: unknown): Promise<void>;
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
