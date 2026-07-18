import { z } from "zod";
import type { PiAdapter } from "../../adapters/src/index.js";

export const WORKER_PROTOCOL_GENERATION = 1 as const;
export const BUNDLED_PI_SDK_GENERATION = "pi-sdk@0.1.0";
const REQUIRED_WORKER_CAPABILITIES = [
  "run.execute",
  "checkpoint.durable",
  "model.select",
  "mode.select",
  "input.text",
] as const;

const capabilitySchema = z.union([
  z.string().transform(id => ({ id, version: 1, constraints: undefined })),
  z.object({
    id: z.string().min(1),
    version: z.literal(1),
    constraints: z.object({
      values: z.array(z.string()).min(1).optional(),
      maximumBytes: z.number().int().positive().optional(),
    }).strict().optional(),
  }).strict(),
]);

const workerReadinessSchema = z.object({
  protocolGeneration: z.literal(WORKER_PROTOCOL_GENERATION),
  sdkGeneration: z.literal(BUNDLED_PI_SDK_GENERATION),
  capabilities: z.array(capabilitySchema),
}).strict();

const executionResultSchema = z.object({
  text: z.string(),
  checkpoint: z.string().min(1),
});

type WorkerCapability = z.infer<typeof capabilitySchema>;
type WorkerReadinessErrorCode =
  | "pi-sdk-unavailable"
  | "worker-readiness-schema-mismatch"
  | "missing-required-worker-capability";

/** One immutable Session binding and one-at-a-time SDK execution boundary. */
export class PiSessionWorker {
  readonly #sessionId: string;
  readonly #pi: PiAdapter;
  #running = false;

  constructor(sessionId: string, pi: PiAdapter) {
    this.#sessionId = sessionId;
    this.#pi = pi;
  }

  static async probe(pi: PiAdapter): Promise<readonly WorkerCapability[]> {
    if (!pi.probe || !pi.execute) {
      throw new WorkerReadinessError("pi-sdk-unavailable");
    }

    let readiness: z.infer<typeof workerReadinessSchema>;
    try {
      readiness = workerReadinessSchema.parse(
        await pi.probe({
          protocolGeneration: WORKER_PROTOCOL_GENERATION,
          sdkGeneration: BUNDLED_PI_SDK_GENERATION,
        }),
      );
    } catch (cause) {
      throw new WorkerReadinessError("worker-readiness-schema-mismatch", cause);
    }

    const capabilityIds = new Set(
      readiness.capabilities.map(capability => capability.id),
    );
    const missingCapabilities = REQUIRED_WORKER_CAPABILITIES.filter(
      id => !capabilityIds.has(id),
    );
    if (missingCapabilities.length > 0) {
      throw new WorkerReadinessError(
        "missing-required-worker-capability",
        missingCapabilities,
      );
    }

    return Object.freeze(
      readiness.capabilities.map(capability => Object.freeze(capability)),
    );
  }

  async execute(prompt: string): Promise<{ text: string; checkpoint: string }> {
    if (this.#running) {
      throw new Error("worker-busy");
    }

    this.#running = true;
    try {
      await PiSessionWorker.probe(this.#pi);
      const execute = this.#pi.execute;
      if (!execute) {
        throw new WorkerReadinessError("pi-sdk-unavailable");
      }

      return executionResultSchema.parse(
        await execute({
          sessionId: this.#sessionId,
          prompt,
          projectTrust: true,
          resourceLoader: "public",
        }),
      );
    } finally {
      this.#running = false;
    }
  }
}

export class WorkerReadinessError extends Error {
  readonly code: WorkerReadinessErrorCode;
  readonly diagnostic: unknown;

  constructor(code: WorkerReadinessErrorCode, diagnostic?: unknown) {
    const diagnosticMessage =
      diagnostic instanceof Error ? `: ${diagnostic.message}` : "";
    super(`${code}${diagnosticMessage}`);
    this.name = "WorkerReadinessError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}
