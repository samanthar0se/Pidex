import { win32 } from "node:path";
import { z } from "zod";

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
