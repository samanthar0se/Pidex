import { win32 } from "node:path";
import { z } from "zod";
import { mapWindowsNativeError, type WindowsPlatformError } from "./errors.js";
import type { ManagedWindowsResource, StoragePort } from "./ports.js";

export const storageDriveTypes = [
  "fixed",
  "removable",
  "remote",
  "optical",
  "ramdisk",
  "unknown",
] as const;

export type StorageDriveType = typeof storageDriveTypes[number];

export interface StoragePathInspection {
  coverage: "covered" | "outside-boundary" | "indeterminate";
  fileSystem?: string;
  driveType: StorageDriveType;
}

export function createStoragePort(
  inspectStoragePath: (path: string) => unknown,
  observeStorageTopology: () => Promise<{ close(): Promise<void>; lateFault?: Promise<unknown> }>,
): StoragePort {
  const inspector = createStoragePathInspector(inspectStoragePath);
  return {
    ...inspector,
    async observeTopology() {
      let native;
      try { native = await observeStorageTopology(); }
      catch (error) { throw mapWindowsNativeError(error, "observeStorageTopology"); }
      return new StorageTopologyResource(native);
    },
  };
}

class StorageTopologyResource implements ManagedWindowsResource {
  readonly lateFault: Promise<WindowsPlatformError>;
  private closing?: Promise<void>;

  constructor(private readonly native: { close(): Promise<void>; lateFault?: Promise<unknown> }) {
    this.lateFault = native.lateFault
      ? native.lateFault.then(error => mapWindowsNativeError(error, "observeStorageTopology"))
      : new Promise(() => undefined);
  }

  close(): Promise<void> {
    return this.closing ??= this.native.close().catch(error => {
      throw mapWindowsNativeError(error, "closeStorageTopology");
    });
  }
}

const storageFactsSchema = z.strictObject({
  fileSystem: z.string().min(1).max(64),
  driveType: z.enum(storageDriveTypes),
});

export function createStoragePathInspector(
  inspectStoragePath: (path: string) => unknown,
): { inspectPath(input: { path: string }): Promise<StoragePathInspection> } {
  return {
    async inspectPath(input): Promise<StoragePathInspection> {
      if (!win32.isAbsolute(input.path)) throw new Error("Storage path must be absolute");
      try {
        const value = await inspectStoragePath(input.path);
        return classifyStorageFacts(value);
      } catch {
        return { coverage: "indeterminate", driveType: "unknown" };
      }
    },
  };
}

function classifyStorageFacts(value: unknown): StoragePathInspection {
  const facts = storageFactsSchema.parse(value);
  const fileSystem = facts.fileSystem.toUpperCase();
  return {
    coverage: fileSystem === "NTFS" && facts.driveType === "fixed" ? "covered" : "outside-boundary",
    fileSystem,
    driveType: facts.driveType,
  };
}
