import { z } from "zod";

export const WORKER_PROTOCOL_GENERATION = 1 as const;
export const MAX_WORKER_FRAME_BYTES = 256 * 1024;
export const MAX_WORKER_QUEUE_BYTES = 4 * 1024 * 1024;
export const WORKER_HEARTBEAT_TIMEOUT_MS = 30_000;

const identifierSchema = z.string().min(1).max(200);
const textSchema = z.string().max(100_000);
const messageSchema = z.string().max(4_000);
const correlationFields = { correlationId: identifierSchema };
const envelopeFields = {
  sessionId: identifierSchema,
  workerId: identifierSchema,
  generation: z.number().int().nonnegative(),
  protocolGeneration: z.literal(WORKER_PROTOCOL_GENERATION),
  sequence: z.number().int().nonnegative(),
};
const capabilitySchema = z.strictObject({
  id: identifierSchema,
  version: z.number().int().positive(),
  constraints: z
    .strictObject({
      values: z.array(z.string().max(1_000)).max(100).optional(),
      maximumBytes: z
        .number()
        .int()
        .positive()
        .max(MAX_WORKER_FRAME_BYTES)
        .optional(),
    })
    .optional(),
});
const factSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("assistant.delta"), text: textSchema }),
  z.strictObject({
    type: z.literal("tool.started"),
    toolCallId: identifierSchema,
    name: z.string().min(1).max(500),
  }),
  z.strictObject({
    type: z.literal("tool.completed"),
    toolCallId: identifierSchema,
    name: z.string().min(1).max(500),
    text: textSchema,
  }),
]);
const interactionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("select"),
    message: messageSchema,
    options: z.array(z.string().max(1_000)).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("confirm"),
    message: messageSchema,
    defaultValue: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("input"),
    message: messageSchema,
    defaultValue: textSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("editor"),
    message: messageSchema,
    defaultValue: textSchema.optional(),
  }),
]);
const interactionResponseSchema = z.union([
  z.strictObject({ dismissed: z.literal(true) }),
  z.strictObject({
    dismissed: z.literal(false),
    value: z.union([textSchema, z.boolean()]),
  }),
]);

export const workerFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...envelopeFields,
    type: z.literal("bootstrap"),
    releaseGeneration: identifierSchema,
    configGeneration: identifierSchema,
    piGeneration: identifierSchema,
    cwd: z.string().min(1).max(32_767),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("ready"),
    capabilities: z.array(capabilitySchema).min(1).max(100),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("execute"),
    ...correlationFields,
    prompt: textSchema,
    model: identifierSchema.optional(),
    mode: identifierSchema.optional(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("fact"),
    ...correlationFields,
    fact: factSchema,
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("steer"),
    ...correlationFields,
    text: textSchema,
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("stop"),
    ...correlationFields,
    reason: z.enum(["user", "host", "shutdown", "deadline"]),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("interaction.request"),
    ...correlationFields,
    runCorrelationId: identifierSchema.optional(),
    interaction: interactionSchema,
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("interaction.response"),
    ...correlationFields,
    response: interactionResponseSchema,
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("interaction.applied"),
    ...correlationFields,
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("heartbeat"),
    monotonicMs: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("checkpoint"),
    ...correlationFields,
    checkpointId: identifierSchema,
    state: z.enum(["exported", "published", "rejected"]),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("outcome"),
    ...correlationFields,
    outcome: z.enum(["completed", "failed", "cancelled", "interrupted"]),
    checkpointId: identifierSchema.optional(),
    detail: messageSchema.optional(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("fault"),
    scope: z.enum(["readiness", "run", "generation"]),
    correlationId: identifierSchema.optional(),
    code: identifierSchema,
    retryable: z.boolean(),
    detail: messageSchema.optional(),
  }),
]);

export type WorkerFrame = z.infer<typeof workerFrameSchema>;
export type WorkerGenerationIdentity = Pick<
  WorkerFrame,
  "sessionId" | "workerId" | "generation" | "protocolGeneration"
>;

export function decodeWorkerFrame(input: string | Uint8Array): WorkerFrame {
  const bytes =
    typeof input === "string" ? Buffer.byteLength(input) : input.byteLength;
  if (bytes > MAX_WORKER_FRAME_BYTES) {
    throw new WorkerProtocolError("oversized-worker-frame");
  }

  try {
    const source =
      typeof input === "string"
        ? input
        : new TextDecoder("utf-8", { fatal: true }).decode(input);
    return workerFrameSchema.parse(JSON.parse(source));
  } catch (cause) {
    if (cause instanceof WorkerProtocolError) {
      throw cause;
    }
    throw new WorkerProtocolError("malformed-worker-frame", { cause });
  }
}

export function encodeWorkerFrame(frame: WorkerFrame): Buffer {
  const encoded = Buffer.from(JSON.stringify(workerFrameSchema.parse(frame)));
  if (encoded.byteLength > MAX_WORKER_FRAME_BYTES) {
    throw new WorkerProtocolError("oversized-worker-frame");
  }
  return encoded;
}

interface SessionWorkerProtocolOptions {
  now?: () => number;
  maxQueuedBytes?: number;
  heartbeatTimeoutMs?: number;
}

export class SessionWorkerProtocol {
  readonly #identity: WorkerGenerationIdentity;
  readonly #now: () => number;
  readonly #maxQueuedBytes: number;
  readonly #heartbeatTimeoutMs: number;
  #nextSequence = 0;
  #nextOutboundSequence = 0;
  #lastHeartbeat: number;
  #queuedBytes = 0;
  readonly #queue: Buffer[] = [];

  constructor(
    identity: WorkerGenerationIdentity,
    options: SessionWorkerProtocolOptions = {},
  ) {
    this.#identity = Object.freeze({ ...identity });
    this.#now = options.now ?? Date.now;
    this.#maxQueuedBytes = options.maxQueuedBytes ?? MAX_WORKER_QUEUE_BYTES;
    this.#heartbeatTimeoutMs =
      options.heartbeatTimeoutMs ?? WORKER_HEARTBEAT_TIMEOUT_MS;
    this.#lastHeartbeat = this.#now();
  }

  accept(input: unknown): WorkerFrame {
    let frame: WorkerFrame;
    try {
      frame = workerFrameSchema.parse(input);
    } catch (cause) {
      this.#fail("malformed-frame", cause);
    }

    this.#assertIdentity(frame);
    if (frame.sequence !== this.#nextSequence) {
      this.#fail("invalid-frame-order");
    }
    this.#nextSequence++;
    if (frame.type === "heartbeat") {
      this.#lastHeartbeat = this.#now();
    }
    return frame;
  }

  enqueue(frame: WorkerFrame): void {
    this.#assertIdentity(frame);
    if (frame.sequence !== this.#nextOutboundSequence) {
      this.#fail("invalid-frame-order");
    }

    let encoded: Buffer;
    try {
      encoded = encodeWorkerFrame(frame);
    } catch (cause) {
      this.#fail("malformed-frame", cause);
    }

    if (this.#queuedBytes + encoded.byteLength > this.#maxQueuedBytes) {
      this.#fail("outbound-backpressure-overflow");
    }
    this.#queue.push(encoded);
    this.#queuedBytes += encoded.byteLength;
    this.#nextOutboundSequence++;
  }

  drain(): Buffer | undefined {
    const value = this.#queue.shift();
    if (value) {
      this.#queuedBytes -= value.byteLength;
    }
    return value;
  }

  noteHeartbeat(at = this.#now()): void {
    this.#lastHeartbeat = at;
  }

  checkHeartbeat(at = this.#now()): void {
    if (at - this.#lastHeartbeat > this.#heartbeatTimeoutMs) {
      this.#fail("heartbeat-lost");
    }
  }

  transportDisconnected(): never {
    return this.#fail("worker-disconnected");
  }

  workerExited(exitCode: number | null): never {
    return this.#fail("worker-exited", exitCode);
  }

  executionHung(correlationId: string): never {
    return this.#fail("worker-hung", correlationId);
  }

  #assertIdentity(frame: WorkerFrame): void {
    if (
      frame.sessionId !== this.#identity.sessionId ||
      frame.workerId !== this.#identity.workerId ||
      frame.generation !== this.#identity.generation ||
      frame.protocolGeneration !== this.#identity.protocolGeneration
    ) {
      this.#fail("stale-or-mismatched-generation");
    }
  }

  #fail(code: string, diagnostic?: unknown): never {
    throw new WorkerGenerationFailure(code, this.#identity, diagnostic);
  }
}

type GenerationRunState =
  | "idle"
  | "executing"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
type GenerationInteractionState = "open" | "applying" | "responded" | "withdrawn";

/**
 * Host-side state machine for one immutable child generation. It deliberately
 * has no replay operation: a lost executing Run can only become interrupted.
 */
export class SessionGenerationLifecycle {
  readonly #identity: WorkerGenerationIdentity;
  readonly #requiredCapabilities: readonly string[];
  #capabilities = new Set<string>();
  #configGeneration?: string;
  #runCorrelationId?: string;
  #usedCorrelations = new Set<string>();
  #runState: GenerationRunState = "idle";
  #failed = false;
  readonly #interactions = new Map<string, GenerationInteractionState>();

  constructor(
    identity: WorkerGenerationIdentity,
    options: { requiredCapabilities?: readonly string[] } = {},
  ) {
    this.#identity = Object.freeze({ ...identity });
    this.#requiredCapabilities = options.requiredCapabilities ?? [];
  }

  get runState(): GenerationRunState { return this.#runState; }
  get shouldReplay(): false { return false; }

  ready(capabilities: readonly { id: string; version: number }[], configGeneration: string): void {
    if (this.#failed || this.#configGeneration) throw new WorkerGenerationFailure("duplicate-readiness", this.#identity);
    this.#capabilities = new Set(capabilities.map(capability => capability.id));
    const missing = this.#requiredCapabilities.filter(id => !this.#capabilities.has(id));
    if (missing.length) throw new WorkerGenerationFailure("missing-required-capability", this.#identity, missing);
    this.#configGeneration = configGeneration;
  }

  execute(correlationId: string): void {
    if (!this.#configGeneration) throw new WorkerGenerationFailure("generation-not-ready", this.#identity);
    if (this.#failed) throw new WorkerGenerationFailure("generation-failed", this.#identity);
    if (this.#usedCorrelations.has(correlationId)) throw new WorkerGenerationFailure("run-correlation-reused", this.#identity);
    if (this.#runState === "executing" || this.#runState === "cancelling") throw new WorkerGenerationFailure("generation-busy", this.#identity);
    this.#usedCorrelations.add(correlationId);
    this.#runCorrelationId = correlationId;
    this.#runState = "executing";
  }

  stop(correlationId: string): "requested" {
    this.#assertActive(correlationId);
    if (!this.#capabilities.has("runtime.cancel")) throw new WorkerGenerationFailure("cancellation-unsupported", this.#identity);
    this.#runState = "cancelling";
    return "requested";
  }

  settle(correlationId: string, outcome: "completed" | "failed" | "cancelled" | "interrupted", checkpointId?: string): void {
    this.#assertActive(correlationId);
    if ((outcome === "completed" || outcome === "cancelled") && !checkpointId) throw new WorkerGenerationFailure("terminal-proof-missing", this.#identity);
    this.#runState = outcome;
    this.#runCorrelationId = undefined;
  }

  configurationChanged(configGeneration: string): void {
    if (configGeneration !== this.#configGeneration) throw new WorkerGenerationFailure("generation-replacement-required", this.#identity);
  }

  openInteraction(interactionId: string, runCorrelationId: string): void {
    this.#assertActive(runCorrelationId);
    if (!this.#capabilities.has("interaction.basic")) throw new WorkerGenerationFailure("interaction-unsupported", this.#identity);
    if (this.#interactions.has(interactionId)) throw new WorkerGenerationFailure("interaction-correlation-reused", this.#identity);
    this.#interactions.set(interactionId, "open");
  }

  respondInteraction(interactionId: string): void {
    if (this.#interactions.get(interactionId) !== "open") throw new WorkerGenerationFailure("interaction-not-open", this.#identity);
    this.#interactions.set(interactionId, "applying");
  }

  acknowledgeInteraction(interactionId: string): void {
    if (this.#interactions.get(interactionId) !== "applying") throw new WorkerGenerationFailure("interaction-not-applying", this.#identity);
    this.#interactions.set(interactionId, "responded");
  }

  interactionState(interactionId: string): GenerationInteractionState | undefined {
    return this.#interactions.get(interactionId);
  }

  fail(code: string): void {
    this.#failed = true;
    if (this.#runState === "executing" || this.#runState === "cancelling") this.#runState = "interrupted";
    this.#runCorrelationId = undefined;
    for (const [id, state] of this.#interactions) {
      if (state === "open" || state === "applying") this.#interactions.set(id, "withdrawn");
    }
  }

  #assertActive(correlationId: string): void {
    if (this.#runCorrelationId !== correlationId || (this.#runState !== "executing" && this.#runState !== "cancelling")) {
      throw new WorkerGenerationFailure("stale-run-correlation", this.#identity);
    }
  }
}

export class WorkerProtocolError extends Error {
  constructor(
    readonly code: "oversized-worker-frame" | "malformed-worker-frame",
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "WorkerProtocolError";
  }
}

export class WorkerGenerationFailure extends Error {
  readonly sessionId: string;
  readonly workerId: string;
  readonly generation: number;
  readonly diagnostic: unknown;

  constructor(
    readonly code: string,
    identity: WorkerGenerationIdentity,
    diagnostic?: unknown,
  ) {
    super(code);
    this.name = "WorkerGenerationFailure";
    this.sessionId = identity.sessionId;
    this.workerId = identity.workerId;
    this.generation = identity.generation;
    this.diagnostic = diagnostic;
  }
}
