import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type {
  CertificateIntegration,
  FirewallIntegration,
  IntegrationInspection,
} from "../../windows/src/index.js";

const MARKER_FILE = ".pidex-source-instance.json";
const CANONICAL_PORT = 47831 as const;
const ROLE_DIRECTORIES = [
  "authority-generations", "generation-selectors", "blobs", "checkpoint-chunks",
  "checkpoint-manifests", "worker-state", "migration-staging", "recovery-snapshots",
  "backups", "diagnostics", "launcher", "publication-temp", "releases",
] as const;

export interface SourceExecutionIdentity {
  owningSid: string;
  tokenSid: string;
  administrator: boolean;
  elevated: boolean;
  appContainer: boolean;
}

interface EnsureResult {
  changed: boolean;
  inspection: IntegrationInspection;
}

export interface SourceInstanceIntegrationPort {
  ensureCertificate(input: CertificateIntegration): Promise<EnsureResult>;
  ensureFirewallRule(input: FirewallIntegration): Promise<EnsureResult>;
  removeCertificate?(input: CertificateIntegration): Promise<void>;
  removeFirewallRule?(input: FirewallIntegration): Promise<void>;
}

export interface SourceTlsMaterial {
  caCertificate: string | Uint8Array;
  caPrivateKey: string | Uint8Array;
  hostCertificate: string | Uint8Array;
  hostPrivateKey: string | Uint8Array;
}

export interface SourceInstanceOptions {
  checkoutDirectory: string;
  profileDirectory: string;
  identity: SourceExecutionIdentity;
  integrations: SourceInstanceIntegrationPort;
  createTlsMaterial(): Promise<SourceTlsMaterial>;
}

export interface PreparedSourceInstance {
  instanceId: string;
  sourceRoot: string;
  markerPath: string;
  created: boolean;
}

interface SourceMarker {
  schemaVersion: 1;
  instanceId: string;
}

interface PreparedState {
  schemaVersion: 1;
  instanceId: string;
  owningSid: string;
  certificateSha256: string;
}

export async function prepareSourceInstance(
  options: SourceInstanceOptions,
): Promise<PreparedSourceInstance> {
  assertSourceIdentity(options.identity);

  const checkout = resolve(options.checkoutDirectory);
  const profile = resolve(options.profileDirectory);
  const markerPath = join(checkout, MARKER_FILE);
  const existingMarker = readJsonIfPresent<SourceMarker>(markerPath);
  const marker = existingMarker ?? { schemaVersion: 1, instanceId: randomUUID() };
  validateMarker(marker);
  const sourceRoot = join(profile, "Pidex", "Source", marker.instanceId);
  const statePath = join(sourceRoot, "instance.json");
  const existingState = readJsonIfPresent<PreparedState>(statePath);
  if (existingState) validatePreparedState(existingState, marker.instanceId, options.identity.owningSid);

  // All caller and existing-state guards intentionally precede the first mutation.
  mkdirSync(checkout, { recursive: true });
  if (!existingMarker) writeJsonExclusive(markerPath, marker);
  mkdirSync(sourceRoot, { recursive: true });
  for (const directory of ROLE_DIRECTORIES) mkdirSync(join(sourceRoot, directory), { recursive: true });
  mkdirSync(join(sourceRoot, "control"), { recursive: true });
  mkdirSync(join(sourceRoot, "tls"), { recursive: true });

  let state = existingState;
  if (!state) {
    const tls = await options.createTlsMaterial();
    const caPath = join(sourceRoot, "tls", "pidex-ca.pem");
    writePrivateFileExclusive(join(sourceRoot, "control", "control.key"), randomBytes(32));
    writePrivateFileExclusive(caPath, tls.caCertificate);
    writePrivateFileExclusive(join(sourceRoot, "tls", "pidex-ca-key.pem"), tls.caPrivateKey);
    writePrivateFileExclusive(join(sourceRoot, "tls", "host.pem"), tls.hostCertificate);
    writePrivateFileExclusive(join(sourceRoot, "tls", "host-key.pem"), tls.hostPrivateKey);
    state = {
      schemaVersion: 1,
      instanceId: marker.instanceId,
      owningSid: options.identity.owningSid,
      certificateSha256: sha256(readFileSync(caPath)),
    };
    writeJsonExclusive(statePath, state);
  }

  await options.integrations.ensureCertificate(certificateIntegration(sourceRoot, state));
  await options.integrations.ensureFirewallRule(firewallIntegration(state.instanceId));
  const preparationPath = join(sourceRoot, "prepared.json");
  const preparation = readJsonIfPresent<SourceMarker>(preparationPath);
  if (preparation) validatePreparedMarker(preparation, state.instanceId);
  else writeJsonExclusive(preparationPath, { schemaVersion: 1, instanceId: state.instanceId } satisfies SourceMarker);
  return { instanceId: state.instanceId, sourceRoot, markerPath, created: !existingState };
}

export async function unprepareSourceInstance(
  options: Omit<SourceInstanceOptions, "createTlsMaterial">,
): Promise<PreparedSourceInstance> {
  assertSourceIdentity(options.identity);
  const checkout = resolve(options.checkoutDirectory);
  const markerPath = join(checkout, MARKER_FILE);
  const marker = readJsonIfPresent<SourceMarker>(markerPath);
  if (!marker) throw new Error("source checkout is not prepared");
  validateMarker(marker);
  const sourceRoot = join(resolve(options.profileDirectory), "Pidex", "Source", marker.instanceId);
  const state = readJsonIfPresent<PreparedState>(join(sourceRoot, "instance.json"));
  if (!state) throw new Error("source checkout is not prepared");
  validatePreparedState(state, marker.instanceId, options.identity.owningSid);
  if (!options.integrations.removeCertificate || !options.integrations.removeFirewallRule) {
    throw new Error("source unprepare requires removal integrations");
  }
  // Once integration removal begins, start must fail even if a native removal
  // reports a partial failure. A later explicit prepare inspects and repairs it.
  rmSync(join(sourceRoot, "prepared.json"), { force: true });
  await options.integrations.removeCertificate(certificateIntegration(sourceRoot, state));
  await options.integrations.removeFirewallRule(firewallIntegration(state.instanceId));
  return { instanceId: state.instanceId, sourceRoot, markerPath, created: false };
}

function assertSourceIdentity(identity: SourceExecutionIdentity): void {
  if (identity.owningSid !== identity.tokenSid) throw new Error("source lifecycle requires elevation under the same owning Windows identity");
  if (!identity.administrator) throw new Error("source lifecycle requires a local administrator");
  if (!identity.elevated) throw new Error("source lifecycle requires an elevated token");
  if (identity.appContainer) throw new Error("source lifecycle rejects AppContainer tokens");
}

function validateMarker(marker: SourceMarker): void {
  if (marker.schemaVersion !== 1 || !/^[0-9a-f-]{36}$/i.test(marker.instanceId)) throw new Error("invalid source checkout marker");
}

function validatePreparedMarker(marker: SourceMarker, instanceId: string): void {
  validateMarker(marker);
  if (marker.instanceId !== instanceId) throw new Error("source preparation identity mismatch");
}

function validatePreparedState(state: PreparedState, instanceId: string, owningSid: string): void {
  if (state.schemaVersion !== 1 || state.instanceId !== instanceId) throw new Error("source instance identity mismatch");
  if (state.owningSid !== owningSid) throw new Error("source instance belongs to another Windows identity");
  if (!/^[a-f0-9]{64}$/.test(state.certificateSha256)) throw new Error("invalid prepared source state");
}

function certificateIntegration(sourceRoot: string, state: PreparedState): CertificateIntegration {
  return { instanceId: state.instanceId, certificatePath: join(sourceRoot, "tls", "pidex-ca.pem"), sha256: state.certificateSha256 };
}

function firewallIntegration(instanceId: string): FirewallIntegration {
  return { instanceId, name: `Pidex Source ${instanceId}`, port: CANONICAL_PORT };
}

function readJsonIfPresent<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function writeJsonExclusive(path: string, value: unknown): void {
  writePrivateFileExclusive(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writePrivateFileExclusive(path: string, value: string | Uint8Array): void {
  writeFileSync(path, value, { flag: "wx", mode: 0o600 });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
