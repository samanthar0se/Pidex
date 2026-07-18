import { z } from "zod";
import type {
  PiAdapter,
  PiPresentationEffect,
  PiInteractionRequest,
  PiInteractionResult,
  PiSteeringReceiver,
  PiTimelineEvent,
} from "../../adapters/src/index.js";

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

const timelineEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assistant.delta"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("tool.started"),
      toolCallId: z.string(),
      name: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.completed"),
      toolCallId: z.string(),
      name: z.string(),
      text: z.string(),
    })
    .strict(),
]);
const interactionTimeoutSchema = z.number()
  .int()
  .nonnegative()
  .max(2_147_483_647)
  .optional();
const interactionRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      correlationId: z.string().min(1).max(200),
      kind: z.literal("select"),
      message: z.string().max(4000),
      options: z.array(z.string().max(1000)).min(1).max(100),
      provenance: z.string().max(500).optional(),
      timeoutMs: interactionTimeoutSchema,
    })
    .strict(),
  z
    .object({
      correlationId: z.string().min(1).max(200),
      kind: z.literal("confirm"),
      message: z.string().max(4000),
      defaultValue: z.boolean().optional(),
      provenance: z.string().max(500).optional(),
      timeoutMs: interactionTimeoutSchema,
    })
    .strict(),
  z
    .object({
      correlationId: z.string().min(1).max(200),
      kind: z.enum(["input", "editor"]),
      message: z.string().max(4000),
      defaultValue: z.string().max(100_000).optional(),
      provenance: z.string().max(500).optional(),
      timeoutMs: interactionTimeoutSchema,
    })
    .strict(),
]);

const boundedPresentationTextSchema = z.string().max(16_384);
const presentationEffectSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("notification"),
      level: z.enum(["info", "warning", "error"]),
      text: boundedPresentationTextSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("status"),
      key: z.string().min(1).max(200),
      text: boundedPresentationTextSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("widget"),
      key: z.string().min(1).max(200),
      text: boundedPresentationTextSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("title"),
      text: boundedPresentationTextSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("editor-text"),
      text: boundedPresentationTextSchema,
    })
    .strict(),
]);

const PRESENTATION_CAPABILITY_BY_EFFECT_TYPE: Record<
  PiPresentationEffect["type"],
  string
> = {
  notification: "presentation.notification",
  status: "presentation.status",
  widget: "presentation.widget",
  title: "presentation.title",
  "editor-text": "presentation.editor-text",
};

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
  #activeSteeringReceiver?: PiSteeringReceiver;
  #activeCapabilityIds = new Set<string>();
  #abortController?: AbortController;

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

  async steer(text: string): Promise<void> {
    const receiver = this.#activeSteeringReceiver;
    if (
      !this.#running ||
      !this.#activeCapabilityIds.has("runtime.steer") ||
      !receiver
    ) {
      throw new Error("steering-unavailable");
    }
    await receiver(text);
  }

  stop(): void {
    if (!this.#running || !this.#activeCapabilityIds.has("runtime.cancel")) {
      throw new Error("cancellation-unavailable");
    }
    this.#activeSteeringReceiver = undefined;
    this.#abortController?.abort();
  }

  async execute(
    prompt: string,
    onTimelineEvent?: (event: PiTimelineEvent) => void,
    onPresentationEffect?: (effect: PiPresentationEffect) => void,
    onInteraction?: (
      request: PiInteractionRequest,
    ) => Promise<PiInteractionResult>,
  ): Promise<{ text: string; checkpoint: string }> {
    if (this.#running) {
      throw new Error("worker-busy");
    }

    this.#running = true;
    this.#abortController = new AbortController();
    try {
      const capabilities = await PiSessionWorker.probe(this.#pi);
      const capabilityIds = new Set(capabilities.map(item => item.id));
      this.#activeCapabilityIds = capabilityIds;
      const execute = this.#pi.execute;
      if (!execute) {
        throw new WorkerReadinessError("pi-sdk-unavailable");
      }

      const executionResult = executionResultSchema.parse(
        await execute({
          sessionId: this.#sessionId,
          prompt,
          projectTrust: true,
          resourceLoader: "public",
          onTimelineEvent: event => {
            const timelineEvent = timelineEventSchema.parse(event);
            onTimelineEvent?.(timelineEvent);
          },
          onPresentationEffect: effect => {
            const presentationEffect = presentationEffectSchema.parse(effect);
            const requiredCapability =
              PRESENTATION_CAPABILITY_BY_EFFECT_TYPE[presentationEffect.type];
            if (capabilityIds.has(requiredCapability)) {
              onPresentationEffect?.(presentationEffect);
            }
          },
          onInteraction: async request => {
            if (!capabilities.some(item => item.id === "interaction.basic")) {
              throw new Error("interaction-capability-unavailable");
            }
            if (!onInteraction) {
              throw new Error("interaction-handler-unavailable");
            }
            return onInteraction(interactionRequestSchema.parse(request));
          },
          registerSteeringReceiver: receiver => {
            this.#activeSteeringReceiver = receiver;
          },
          signal: this.#abortController.signal,
        }),
      );
      if (!this.#pi.flushCheckpoint) {
        throw new Error("checkpoint-flush-unavailable");
      }
      const durableCheckpoint = await this.#pi.flushCheckpoint(
        this.#sessionId,
        executionResult.checkpoint,
      );
      if (durableCheckpoint !== executionResult.checkpoint) {
        throw new Error("checkpoint-evidence-mismatch");
      }
      return executionResult;
    } finally {
      this.#activeSteeringReceiver = undefined;
      this.#abortController = undefined;
      this.#activeCapabilityIds.clear();
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
