import { createHash } from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";
import { createRequire } from "node:module";
import { z } from "zod";
import type { ResolvedLaunchManifest } from "../../launch-manifest/src/index.js";
import { createDiagnosticsPort } from "./diagnostics.js";
import { mapWindowsNativeError } from "./errors.js";
import type { DiagnosticsPort, StoragePort } from "./ports.js";
import { createStoragePathInspector } from "./storage.js";

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

interface RawAddon {
  descriptor: unknown;
  selfTest?: unknown;
  [name: string]: unknown;
}

export interface WindowsAddonBinding {
  selfTest(): Promise<void>;
  readonly storage: Pick<StoragePort, "inspectPath">;
  readonly diagnostics: DiagnosticsPort;
}

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
const expectedExports = ["selfTest", "inspectStoragePath", "writeDiagnosticEvent"];

export async function loadWindowsAddon(
  manifest: ResolvedLaunchManifest,
  loader: NativeModuleLoader = {},
): Promise<WindowsAddonBinding> {
  const runtime = loader.runtime ?? {
    platform: process.platform,
    architecture: process.arch,
    nodeApi: Number(process.versions.napi ?? -1),
  };
  validateRuntime(runtime, manifest);

  const path = manifest.artifacts.addon.path;
  const readFile = loader.readFile ?? readFileFromDisk;
  const expectedHash = manifest.artifacts.addon.sha256;
  validateHash(await readFile(path), expectedHash, "Windows addon hash mismatch");

  const loadModule = loader.loadModule ?? (candidate => require(candidate) as RawAddon);
  const addon = loadModule(path);
  validateHash(await readFile(path), expectedHash, "Windows addon changed while loading");
  validateAddon(addon, manifest);

  return {
    async selfTest(): Promise<void> {
      try {
        await (addon.selfTest as () => unknown)();
      } catch (error) {
        throw mapWindowsNativeError(error, "selfTest");
      }
    },
    storage: createStoragePathInspector(addon.inspectStoragePath as (path: string) => unknown),
    diagnostics: createDiagnosticsPort(addon.writeDiagnosticEvent as (event: unknown) => unknown),
  };
}

function validateRuntime(runtime: AddonRuntimeIdentity, manifest: ResolvedLaunchManifest): void {
  if (runtime.platform !== "win32" || runtime.architecture !== "x64") {
    throw new Error("Windows addon architecture mismatch");
  }
  if (runtime.nodeApi !== manifest.runtimes.nodeApi) {
    throw new Error("Windows addon Node-API mismatch");
  }
  if (manifest.runtimes.addonAbi !== `napi-${runtime.nodeApi}`) {
    throw new Error("Windows addon ABI mismatch");
  }
}

function validateHash(bytes: Uint8Array, expectedHash: string, message: string): void {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== expectedHash) {
    throw new Error(message);
  }
}

function validateAddon(addon: RawAddon, manifest: ResolvedLaunchManifest): void {
  const descriptor = descriptorSchema.parse(addon.descriptor);
  const expectedIdentity = {
    nodeApi: manifest.runtimes.nodeApi,
    abi: manifest.runtimes.addonAbi,
    addonGeneration: manifest.generations.addon,
    schemaGeneration: manifest.generations.schema,
    releaseId: manifest.generations.release,
  };

  for (const [field, value] of Object.entries(expectedIdentity)) {
    if (descriptor[field as keyof typeof expectedIdentity] !== value) {
      throw new Error(`Windows addon ${field} mismatch`);
    }
  }

  const nativeExports = Object.keys(addon).filter(name => name !== "descriptor");
  const hasExpectedDescriptor = descriptor.exports.length === expectedExports.length
    && descriptor.exports.every((name, index) => name === expectedExports[index]);
  const hasExpectedNativeExports = nativeExports.length === expectedExports.length
    && expectedExports.every(name => nativeExports.includes(name));
  if (!hasExpectedDescriptor || !hasExpectedNativeExports || typeof addon.selfTest !== "function") {
    throw new Error("Windows addon exports mismatch");
  }
}
