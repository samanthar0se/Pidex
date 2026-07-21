import { z } from "zod";

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
    this.operation = input.operation;
    this.category = input.category;
    this.domain = input.domain;
    this.code = input.code;
    this.retryable = input.retryable;
    this.detail = input.detail;
  }
}

export function mapWindowsNativeError(error: unknown, operation: string): WindowsPlatformError {
  const parsed = nativeErrorSchema.safeParse(error);
  if (parsed.success) {
    return new WindowsPlatformError(parsed.data);
  }

  return new WindowsPlatformError({
    operation,
    category: "internal",
    domain: "node-api",
    code: -1,
    retryable: false,
    detail: "native operation failed",
  });
}
