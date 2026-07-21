import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const LOCAL_CONTROL_LIMITS = Object.freeze({
  frameBytes: 1_048_576,
  stringCharacters: 100_000,
  collectionItems: 1_000,
  inFlightRequests: 64,
});

const id = z.string().min(1).max(200);
const roleSchema = z.enum(["cli", "launcher", "daemon", "maintenance"]);
export type LocalControlRole = z.infer<typeof roleSchema>;

export const compatibilitySchema = z.strictObject({
  generation: z.number().int().nonnegative(),
  requiredSemantics: z.array(id).max(LOCAL_CONTROL_LIMITS.collectionItems),
});

export const authenticationHelloSchema = z.strictObject({
  protocol: z.literal("pidex-local-control-v1"),
  instanceId: id,
  connectionId: id,
  role: roleSchema,
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  compatibility: compatibilitySchema,
});
export type AuthenticationHello = z.infer<typeof authenticationHelloSchema>;

/** Canonical, role-bound transcript used by both peers for HKDF and proofs. */
export function authenticationTranscript(
  client: AuthenticationHello,
  server: AuthenticationHello,
): Buffer {
  const c = authenticationHelloSchema.parse(client);
  const s = authenticationHelloSchema.parse(server);
  if (c.instanceId !== s.instanceId || c.connectionId !== s.connectionId)
    throw new Error("authentication identity mismatch");
  if (c.role !== "cli" || s.role !== "launcher")
    throw new Error("authentication role mismatch");
  return Buffer.from(canonicalJson({ client: c, server: s }), "utf8");
}

export function deriveConnectionKey(
  controlKey: Uint8Array,
  client: AuthenticationHello,
  server: AuthenticationHello,
): Buffer {
  if (controlKey.byteLength !== 32) throw new Error("control key must be 256 bits");
  const transcript = authenticationTranscript(client, server);
  return Buffer.from(hkdfSync("sha256", controlKey, transcript, "pidex/local-control/frame/v1", 32));
}

export function authenticationProof(key: Uint8Array, peer: "client" | "server", transcript: Uint8Array): string {
  return createHmac("sha256", key).update("pidex/local-control/proof/v1\0").update(peer).update(transcript).digest("hex");
}

const requestSchema = z.strictObject({
  kind: z.literal("request"), requestId: id, method: id,
  invocationId: id.optional(), payload: z.unknown(),
});
const responseSchema = z.strictObject({
  kind: z.literal("response"), requestId: id, result: z.unknown(),
});
const eventSchema = z.strictObject({
  kind: z.literal("event"), eventId: id, operationId: id,
  event: z.enum(["progress", "completed"]), payload: z.unknown(),
});
const unsignedFrameSchema = z.strictObject({
  protocol: z.literal("pidex-local-control-v1"), connectionId: id,
  sequence: z.number().int().positive(), sender: roleSchema,
  message: z.discriminatedUnion("kind", [requestSchema, responseSchema, eventSchema]),
});
const frameSchema = unsignedFrameSchema.extend({ mac: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type LocalControlFrame = z.infer<typeof frameSchema>;

export function signFrame(frame: z.input<typeof unsignedFrameSchema>, key: Uint8Array): LocalControlFrame {
  const parsed = unsignedFrameSchema.parse(frame);
  return { ...parsed, mac: createHmac("sha256", key).update(canonicalJson(parsed)).digest("hex") };
}

export function encodeFrame(frame: LocalControlFrame): Buffer {
  const payload = Buffer.from(canonicalJson(frameSchema.parse(frame)), "utf8");
  if (payload.byteLength > LOCAL_CONTROL_LIMITS.frameBytes) throw new Error("frame exceeds byte bound");
  const output = Buffer.allocUnsafe(4 + payload.byteLength);
  output.writeUInt32LE(payload.byteLength); payload.copy(output, 4);
  return output;
}

export function decodeFrame(bytes: Uint8Array): LocalControlFrame {
  const input = Buffer.from(bytes);
  if (input.byteLength < 4) throw new Error("incomplete frame prefix");
  const length = input.readUInt32LE(0);
  if (length > LOCAL_CONTROL_LIMITS.frameBytes) throw new Error("frame exceeds byte bound");
  if (input.byteLength !== length + 4) throw new Error("incomplete frame or trailing data");
  let value: unknown;
  try { value = JSON.parse(input.subarray(4).toString("utf8")); }
  catch { throw new Error("frame is not UTF-8 JSON"); }
  enforceValueBounds(value);
  return frameSchema.parse(value);
}

export class FrameReceiver {
  #next = 1;
  constructor(private readonly connectionId: string, private readonly peerRole: LocalControlRole, private readonly key: Uint8Array) {}
  accept(encoded: Uint8Array): LocalControlFrame {
    const frame = decodeFrame(encoded);
    if (frame.connectionId !== this.connectionId) throw new Error("wrong connection");
    if (frame.sender !== this.peerRole) throw new Error("wrong role");
    if (frame.sequence !== this.#next) throw new Error(frame.sequence < this.#next ? "replayed sequence" : "sequence gap");
    const { mac, ...unsigned } = frame;
    const expected = createHmac("sha256", this.key).update(canonicalJson(unsigned)).digest();
    const actual = Buffer.from(mac, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid frame MAC");
    this.#next += 1;
    return frame;
  }
}

export const invocationSchema = z.strictObject({
  invocationId: id, policyOwner: z.enum(["launcher", "daemon", "maintenance", "source-driver"]),
  operation: id, argumentsDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const operationReceiptSchema = z.strictObject({
  invocationId: id, operationId: id, phase: id,
  state: z.enum(["accepted", "running", "succeeded", "failed", "cancelled"]),
  cancellable: z.boolean(),
});
export const progressSchema = z.strictObject({
  operationId: id, sequence: z.number().int().nonnegative(), phase: id,
  completed: z.number().int().nonnegative(), total: z.number().int().positive().optional(),
  messageCode: id,
});
export const cancellationSchema = z.strictObject({ operationId: id, expectedPhase: id });

export const secretOutputPolicy = Object.freeze({
  allowedInputs: ["hidden-console", "inherited-secret-handle"],
  allowedOutputs: ["interactive-console", "inherited-secret-handle"],
  forbidden: ["stdin", "argv", "environment", "config", "json", "redirected-stdout", "receipt", "log", "diagnostic", "support-bundle"],
});

export function assertCompatible(local: z.input<typeof compatibilitySchema>, remote: z.input<typeof compatibilitySchema>, understood: ReadonlySet<string>): void {
  const a = compatibilitySchema.parse(local), b = compatibilitySchema.parse(remote);
  if (a.generation !== b.generation) throw new Error("incompatible local-control generation");
  for (const semantic of b.requiredSemantics) if (!understood.has(semantic)) throw new Error(`unknown required semantic: ${semantic}`);
}

function enforceValueBounds(value: unknown): void {
  if (typeof value === "string" && value.length > LOCAL_CONTROL_LIMITS.stringCharacters) throw new Error("string exceeds bound");
  if (Array.isArray(value)) {
    if (value.length > LOCAL_CONTROL_LIMITS.collectionItems) throw new Error("collection exceeds bound");
    value.forEach(enforceValueBounds);
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > LOCAL_CONTROL_LIMITS.collectionItems) throw new Error("collection exceeds bound");
    entries.forEach(([, child]) => enforceValueBounds(child));
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
