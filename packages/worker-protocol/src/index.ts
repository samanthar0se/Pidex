import { z } from "zod";

export const WORKER_PROTOCOL_GENERATION = 1 as const;
export const MAX_WORKER_FRAME_BYTES = 256 * 1024;
export const MAX_WORKER_QUEUE_BYTES = 4 * 1024 * 1024;
export const WORKER_HEARTBEAT_TIMEOUT_MS = 30_000;

const id = z.string().min(1).max(200);
const text = z.string().max(100_000);
const correlation = { correlationId: id };
const envelope = {
  sessionId: id,
  workerId: id,
  generation: z.number().int().nonnegative(),
  protocolGeneration: z.literal(WORKER_PROTOCOL_GENERATION),
  sequence: z.number().int().nonnegative(),
};
const capability = z.strictObject({
  id,
  version: z.number().int().positive(),
  constraints: z.strictObject({
    values: z.array(z.string().max(1_000)).max(100).optional(),
    maximumBytes: z.number().int().positive().max(MAX_WORKER_FRAME_BYTES).optional(),
  }).optional(),
});
const fact = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("assistant.delta"), text }),
  z.strictObject({ type: z.literal("tool.started"), toolCallId: id, name: z.string().min(1).max(500) }),
  z.strictObject({ type: z.literal("tool.completed"), toolCallId: id, name: z.string().min(1).max(500), text }),
]);
const interaction = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("select"), message: z.string().max(4_000), options: z.array(z.string().max(1_000)).min(1).max(100) }),
  z.strictObject({ kind: z.literal("confirm"), message: z.string().max(4_000), defaultValue: z.boolean().optional() }),
  z.strictObject({ kind: z.literal("input"), message: z.string().max(4_000), defaultValue: text.optional() }),
  z.strictObject({ kind: z.literal("editor"), message: z.string().max(4_000), defaultValue: text.optional() }),
]);

export const workerFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...envelope, type: z.literal("bootstrap"), releaseGeneration: id, configGeneration: id, piGeneration: id, cwd: z.string().min(1).max(32_767) }),
  z.strictObject({ ...envelope, type: z.literal("ready"), capabilities: z.array(capability).min(1).max(100) }),
  z.strictObject({ ...envelope, type: z.literal("execute"), ...correlation, prompt: text, model: id.optional(), mode: id.optional() }),
  z.strictObject({ ...envelope, type: z.literal("fact"), ...correlation, fact }),
  z.strictObject({ ...envelope, type: z.literal("steer"), ...correlation, text }),
  z.strictObject({ ...envelope, type: z.literal("stop"), ...correlation, reason: z.enum(["user", "host", "shutdown", "deadline"]) }),
  z.strictObject({ ...envelope, type: z.literal("interaction.request"), ...correlation, runCorrelationId: id.optional(), interaction }),
  z.strictObject({ ...envelope, type: z.literal("interaction.response"), ...correlation, response: z.union([z.strictObject({ dismissed: z.literal(true) }), z.strictObject({ dismissed: z.literal(false), value: z.union([z.string().max(100_000), z.boolean()]) })]) }),
  z.strictObject({ ...envelope, type: z.literal("interaction.applied"), ...correlation }),
  z.strictObject({ ...envelope, type: z.literal("heartbeat"), monotonicMs: z.number().int().nonnegative() }),
  z.strictObject({ ...envelope, type: z.literal("checkpoint"), ...correlation, checkpointId: id, state: z.enum(["exported", "published", "rejected"]) }),
  z.strictObject({ ...envelope, type: z.literal("outcome"), ...correlation, outcome: z.enum(["completed", "failed", "cancelled", "interrupted"]), checkpointId: id.optional(), detail: z.string().max(4_000).optional() }),
  z.strictObject({ ...envelope, type: z.literal("fault"), scope: z.enum(["readiness", "run", "generation"]), correlationId: id.optional(), code: id, retryable: z.boolean(), detail: z.string().max(4_000).optional() }),
]);

export type WorkerFrame = z.infer<typeof workerFrameSchema>;
export type WorkerGenerationIdentity = Pick<WorkerFrame, "sessionId" | "workerId" | "generation" | "protocolGeneration">;

export function decodeWorkerFrame(input: string | Uint8Array): WorkerFrame {
  const bytes = typeof input === "string" ? Buffer.byteLength(input) : input.byteLength;
  if (bytes > MAX_WORKER_FRAME_BYTES) throw new WorkerProtocolError("oversized-worker-frame");
  try {
    const source = typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: true }).decode(input);
    return workerFrameSchema.parse(JSON.parse(source));
  } catch (cause) {
    if (cause instanceof WorkerProtocolError) throw cause;
    throw new WorkerProtocolError("malformed-worker-frame", { cause });
  }
}

export function encodeWorkerFrame(frame: WorkerFrame): Buffer {
  const encoded = Buffer.from(JSON.stringify(workerFrameSchema.parse(frame)));
  if (encoded.byteLength > MAX_WORKER_FRAME_BYTES) throw new WorkerProtocolError("oversized-worker-frame");
  return encoded;
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
  #queue: Buffer[] = [];

  constructor(identity: WorkerGenerationIdentity, options: { now?: () => number; maxQueuedBytes?: number; heartbeatTimeoutMs?: number } = {}) {
    this.#identity = Object.freeze({ ...identity });
    this.#now = options.now ?? Date.now;
    this.#maxQueuedBytes = options.maxQueuedBytes ?? MAX_WORKER_QUEUE_BYTES;
    this.#heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? WORKER_HEARTBEAT_TIMEOUT_MS;
    this.#lastHeartbeat = this.#now();
  }

  accept(input: unknown): WorkerFrame {
    let frame: WorkerFrame;
    try { frame = workerFrameSchema.parse(input); } catch (cause) { return this.#fail("malformed-frame", cause); }
    if (frame.sessionId !== this.#identity.sessionId || frame.workerId !== this.#identity.workerId || frame.generation !== this.#identity.generation || frame.protocolGeneration !== this.#identity.protocolGeneration) {
      return this.#fail("stale-or-mismatched-generation");
    }
    if (frame.sequence !== this.#nextSequence) return this.#fail("invalid-frame-order");
    this.#nextSequence++;
    if (frame.type === "heartbeat") this.#lastHeartbeat = this.#now();
    return frame;
  }

  enqueue(frame: WorkerFrame): void {
    if (frame.sessionId !== this.#identity.sessionId || frame.workerId !== this.#identity.workerId || frame.generation !== this.#identity.generation || frame.protocolGeneration !== this.#identity.protocolGeneration) {
      this.#fail("stale-or-mismatched-generation");
    }
    if (frame.sequence !== this.#nextOutboundSequence) this.#fail("invalid-frame-order");
    let encoded: Buffer;
    try { encoded = encodeWorkerFrame(frame); } catch (cause) { this.#fail("malformed-frame", cause); }
    if (this.#queuedBytes + encoded!.byteLength > this.#maxQueuedBytes) this.#fail("outbound-backpressure-overflow");
    this.#queue.push(encoded!);
    this.#queuedBytes += encoded!.byteLength;
    this.#nextOutboundSequence++;
  }

  drain(): Buffer | undefined {
    const value = this.#queue.shift();
    if (value) this.#queuedBytes -= value.byteLength;
    return value;
  }

  noteHeartbeat(at = this.#now()): void { this.#lastHeartbeat = at; }
  checkHeartbeat(at = this.#now()): void { if (at - this.#lastHeartbeat > this.#heartbeatTimeoutMs) this.#fail("heartbeat-lost"); }
  transportDisconnected(): never { return this.#fail("worker-disconnected"); }
  workerExited(exitCode: number | null): never { return this.#fail("worker-exited", exitCode); }
  executionHung(correlationId: string): never { return this.#fail("worker-hung", correlationId); }
  #fail(code: string, diagnostic?: unknown): never { throw new WorkerGenerationFailure(code, this.#identity, diagnostic); }
}

export class WorkerProtocolError extends Error {
  constructor(readonly code: "oversized-worker-frame" | "malformed-worker-frame", options?: ErrorOptions) { super(code, options); this.name = "WorkerProtocolError"; }
}

export class WorkerGenerationFailure extends Error {
  readonly sessionId: string;
  readonly workerId: string;
  readonly generation: number;
  readonly diagnostic: unknown;
  constructor(readonly code: string, identity: WorkerGenerationIdentity, diagnostic?: unknown) {
    super(code); this.name = "WorkerGenerationFailure";
    this.sessionId = identity.sessionId; this.workerId = identity.workerId; this.generation = identity.generation; this.diagnostic = diagnostic;
  }
}
