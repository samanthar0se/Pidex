import { z } from "zod";
import type { PiAdapter } from "../../adapters/src/index.js";

export const WORKER_PROTOCOL_GENERATION = 1 as const;
export const BUNDLED_PI_SDK_GENERATION = "pi-sdk@0.1.0";
const REQUIRED_WORKER_CAPABILITIES = [
  "run.execute",
  "checkpoint.durable",
] as const;

const workerReadinessSchema = z.object({
  protocolGeneration: z.literal(WORKER_PROTOCOL_GENERATION),
  sdkGeneration: z.literal(BUNDLED_PI_SDK_GENERATION),
  capabilities: z.array(z.string()),
});
const executionResultSchema = z.object({
  text: z.string(),
  checkpoint: z.string().min(1),
});

/** One immutable Session binding and one-at-a-time SDK execution boundary. */
export class PiSessionWorker {
  readonly #sessionId: string;
  readonly #pi: PiAdapter;
  #running = false;

  constructor(sessionId: string, pi: PiAdapter) {
    this.#sessionId = sessionId;
    this.#pi = pi;
  }

  async execute(prompt: string): Promise<{ text: string; checkpoint: string }> {
    if (this.#running) {
      throw new Error("worker-busy");
    }

    this.#running = true;
    try {
      if (!this.#pi.probe || !this.#pi.execute) {
        throw new Error("pi-sdk-unavailable");
      }

      const readiness = workerReadinessSchema.parse(
        await this.#pi.probe({
          protocolGeneration: WORKER_PROTOCOL_GENERATION,
          sdkGeneration: BUNDLED_PI_SDK_GENERATION,
        }),
      );
      const isMissingRequiredCapability = REQUIRED_WORKER_CAPABILITIES.some(
        capability => !readiness.capabilities.includes(capability),
      );
      if (isMissingRequiredCapability) {
        throw new Error("missing-required-worker-capability");
      }

      return executionResultSchema.parse(
        await this.#pi.execute({
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
