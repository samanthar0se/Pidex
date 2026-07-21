import { createHash } from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";
import { createRequire } from "node:module";
import { z } from "zod";
import type { ResolvedLaunchManifest } from "../../launch-manifest/src/index.js";

export const windowsErrorCategorySchema = z.enum([
  "invalid-identity", "permission-denied", "invalid-input", "unavailable",
  "conflict", "resource-exhausted", "internal",
]);
export const windowsNativeDomainSchema = z.enum([
  "win32", "hresult", "dns", "configret", "node-api",
]);

const nativeErrorSchema = z.strictObject({
  operation: z.string().min(1),
  category: windowsErrorCategorySchema,
  domain: windowsNativeDomainSchema,
  code: z.number().int(),
  retryable: z.boolean(),
  detail: z.string().min(1).max(500),
});

export class WindowsPlatformError extends Error {
  readonly operation: string;
  readonly category: z.infer<typeof windowsErrorCategorySchema>;
  readonly domain: z.infer<typeof windowsNativeDomainSchema>;
  readonly code: number;
  readonly retryable: boolean;
  readonly detail: string;

  constructor(input: z.infer<typeof nativeErrorSchema>) {
    super(`${input.operation} failed (${input.category})`);
    this.name = "WindowsPlatformError";
    Object.assign(this, input);
    this.operation = input.operation;
    this.category = input.category;
    this.domain = input.domain;
    this.code = input.code;
    this.retryable = input.retryable;
    this.detail = input.detail;
  }
}

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
export interface ProcessPort { spawnContained(input: unknown): Promise<ManagedWindowsResource>; }
export interface StoragePort {
  inspectPath(input: { path: string }): Promise<unknown>;
  observeTopology(): Promise<ManagedWindowsResource>;
}
export interface DiagnosticsPort { writeEvent(input: unknown): Promise<boolean>; }

const descriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  architecture: z.literal("x64"),
  nodeApi: z.number().int().nonnegative(),
  abi: z.string().regex(/^napi-\d+$/),
  addonGeneration: z.number().int().nonnegative(),
  schemaGeneration: z.number().int().nonnegative(),
  releaseId: z.string().min(1),
  exports: z.array(z.string().min(1)).min(1),
});

interface RawAddon { descriptor: unknown; selfTest?: unknown; [name: string]: unknown; }
export interface WindowsAddonBinding { selfTest(): Promise<void>; }
export interface AddonRuntimeIdentity {
  platform: string;
  architecture: string;
  nodeApi: number;
}
export interface NativeModuleLoader {
  runtime?: AddonRuntimeIdentity;
  readFile?(path: string): Promise<Uint8Array>;
  loadModule?(path: string): RawAddon;
}

const require = createRequire(import.meta.url);

export async function loadWindowsAddon(
  manifest: ResolvedLaunchManifest,
  loader: NativeModuleLoader = {},
): Promise<WindowsAddonBinding> {
  const runtime = loader.runtime ?? {
    platform: process.platform,
    architecture: process.arch,
    nodeApi: Number(process.versions.napi ?? -1),
  };
  if (runtime.platform !== "win32" || runtime.architecture !== "x64") {
    throw new Error("Windows addon architecture mismatch");
  }
  if (runtime.nodeApi !== manifest.runtimes.nodeApi) {
    throw new Error("Windows addon Node-API mismatch");
  }
  if (manifest.runtimes.addonAbi !== `napi-${runtime.nodeApi}`) {
    throw new Error("Windows addon ABI mismatch");
  }

  const path = manifest.artifacts.addon.path;
  const bytes = await (loader.readFile ?? readFileFromDisk)(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== manifest.artifacts.addon.sha256) {
    throw new Error("Windows addon hash mismatch");
  }

  const addon = (loader.loadModule ?? (candidate => require(candidate) as RawAddon))(path);
  const descriptor = descriptorSchema.parse(addon.descriptor);
  const expected = {
    nodeApi: manifest.runtimes.nodeApi,
    abi: manifest.runtimes.addonAbi,
    addonGeneration: manifest.generations.addon,
    schemaGeneration: manifest.generations.schema,
    releaseId: manifest.generations.release,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (descriptor[field as keyof typeof expected] !== value) {
      throw new Error(`Windows addon ${field} mismatch`);
    }
  }
  if (descriptor.exports.length !== 1 || descriptor.exports[0] !== "selfTest" || typeof addon.selfTest !== "function") {
    throw new Error("Windows addon exports mismatch");
  }

  return {
    async selfTest(): Promise<void> {
      try {
        await (addon.selfTest as () => unknown)();
      } catch (error) {
        const parsed = nativeErrorSchema.safeParse(error);
        if (parsed.success) throw new WindowsPlatformError(parsed.data);
        throw new WindowsPlatformError({ operation: "selfTest", category: "internal", domain: "node-api", code: -1, retryable: false, detail: "native operation failed" });
      }
    },
  };
}
