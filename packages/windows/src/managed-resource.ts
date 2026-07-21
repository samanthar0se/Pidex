import { mapWindowsNativeError, type WindowsPlatformError } from "./errors.js";
import type { ManagedWindowsResource } from "./ports.js";

export interface NativeManagedWindowsResource {
  close(): Promise<void>;
  readonly lateFault?: Promise<unknown>;
}

interface ManagedResourceOperations {
  readonly lateFault: string;
  readonly close: string;
}

export function createManagedWindowsResource(
  native: NativeManagedWindowsResource,
  operations: ManagedResourceOperations,
): ManagedWindowsResource {
  const lateFault: Promise<WindowsPlatformError> = native.lateFault
    ? native.lateFault.then(error => mapWindowsNativeError(error, operations.lateFault))
    : new Promise(() => undefined);
  let closing: Promise<void> | undefined;

  return {
    lateFault,
    close() {
      return closing ??= native.close().catch(error => {
        throw mapWindowsNativeError(error, operations.close);
      });
    },
  };
}
