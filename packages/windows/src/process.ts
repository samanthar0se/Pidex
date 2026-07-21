import { z } from "zod";
import { mapWindowsNativeError, type WindowsPlatformError } from "./errors.js";
import type { ContainedProcessRequest, ManagedProcess, ProcessPort } from "./ports.js";

const absoluteWindowsPath = z.string().regex(/^(?:[A-Za-z]:\\|\\\\)/, "path must be absolute");
const requestSchema = z.strictObject({
  executable: absoluteWindowsPath,
  cwd: absoluteWindowsPath,
  argv: z.array(z.string().max(32_768)).max(256),
  environment: z.record(z.string().min(1).max(32_767), z.string().max(32_767)),
  bootstrapHandle: z.number().int().nonnegative(),
  endpoint: z.string().regex(/^\\\\\.\\pipe\\/).max(256),
  identity: z.strictObject({
    instanceId: z.string().min(1).max(128),
    releaseId: z.string().min(1).max(128),
    protocolGeneration: z.number().int().nonnegative(),
    role: z.enum(["daemon", "worker", "maintenance", "tool"]),
  }),
});

export interface NativeManagedProcess {
  readonly processId: number;
  close(): Promise<void>;
  readonly lateFault?: Promise<unknown>;
}

export interface NativeProcessBinding {
  spawnContained(input: ContainedProcessRequest): Promise<NativeManagedProcess>;
}

export function createProcessPort(native: NativeProcessBinding): ProcessPort {
  return {
    async spawnContained(input) {
      const parsed = requestSchema.parse(input) as ContainedProcessRequest;
      let resource: NativeManagedProcess;
      try { resource = await native.spawnContained(parsed); }
      catch (error) { throw mapWindowsNativeError(error, "spawnContained"); }
      if (!Number.isSafeInteger(resource.processId) || resource.processId <= 0) {
        await resource.close().catch(() => undefined);
        throw mapWindowsNativeError(undefined, "spawnContained");
      }
      return new ProcessResource(resource);
    },
  };
}

class ProcessResource implements ManagedProcess {
  readonly processId: number;
  readonly lateFault: Promise<WindowsPlatformError>;
  private closing?: Promise<void>;

  constructor(private readonly native: NativeManagedProcess) {
    this.processId = native.processId;
    this.lateFault = native.lateFault
      ? native.lateFault.then(error => mapWindowsNativeError(error, "managedProcess"))
      : new Promise(() => undefined);
  }

  close(): Promise<void> {
    return this.closing ??= this.native.close().catch(error => {
      throw mapWindowsNativeError(error, "closeContainedProcess");
    });
  }
}
