import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonical-json.js";
import {
  identifierSchema,
  protocolSchema,
  roleSchema,
  type LocalControlRole,
} from "./contract-schemas.js";

export {
  type ChildBootstrapIdentity,
  OneUseChildBootstrap,
} from "./child-bootstrap.js";
export type { LocalControlRole } from "./contract-schemas.js";
export {
  LocalControlAdmission,
  type LocalPeerEvidence,
} from "./peer-admission.js";

export const LOCAL_CONTROL_LIMITS = Object.freeze({
  frameBytes: 1_048_576,
  stringCharacters: 100_000,
  collectionItems: 1_000,
  inFlightRequests: 64,
});

const hex256BitSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const compatibilitySchema = z.strictObject({
  generation: z.number().int().nonnegative(),
  requiredSemantics: z
    .array(identifierSchema)
    .max(LOCAL_CONTROL_LIMITS.collectionItems),
});

export const authenticationHelloSchema = z.strictObject({
  protocol: protocolSchema,
  instanceId: identifierSchema,
  connectionId: identifierSchema,
  role: roleSchema,
  nonce: hex256BitSchema,
  compatibility: compatibilitySchema,
});
export type AuthenticationHello = z.infer<typeof authenticationHelloSchema>;

/** Canonical, role-bound transcript used by both peers for HKDF and proofs. */
export function authenticationTranscript(
  client: AuthenticationHello,
  server: AuthenticationHello,
): Buffer {
  const parsedClient = authenticationHelloSchema.parse(client);
  const parsedServer = authenticationHelloSchema.parse(server);

  if (
    parsedClient.instanceId !== parsedServer.instanceId ||
    parsedClient.connectionId !== parsedServer.connectionId
  ) {
    throw new Error("authentication identity mismatch");
  }
  if (parsedClient.role !== "cli" || parsedServer.role !== "launcher") {
    throw new Error("authentication role mismatch");
  }

  return Buffer.from(
    canonicalJson({ client: parsedClient, server: parsedServer }),
    "utf8",
  );
}

export function deriveConnectionKey(
  controlKey: Uint8Array,
  client: AuthenticationHello,
  server: AuthenticationHello,
): Buffer {
  if (controlKey.byteLength !== 32) {
    throw new Error("control key must be 256 bits");
  }
  const transcript = authenticationTranscript(client, server);
  return Buffer.from(
    hkdfSync(
      "sha256",
      controlKey,
      transcript,
      "pidex/local-control/frame/v1",
      32,
    ),
  );
}

export function authenticationProof(
  key: Uint8Array,
  peer: "client" | "server",
  transcript: Uint8Array,
): string {
  return createHmac("sha256", key)
    .update("pidex/local-control/proof/v1\0")
    .update(peer)
    .update(transcript)
    .digest("hex");
}

const requestSchema = z.strictObject({
  kind: z.literal("request"),
  requestId: identifierSchema,
  method: identifierSchema,
  invocationId: identifierSchema.optional(),
  payload: z.unknown(),
});
const responseSchema = z.strictObject({
  kind: z.literal("response"),
  requestId: identifierSchema,
  result: z.unknown(),
});
const eventSchema = z.strictObject({
  kind: z.literal("event"),
  eventId: identifierSchema,
  operationId: identifierSchema,
  event: z.enum(["progress", "completed"]),
  payload: z.unknown(),
});
const unsignedFrameSchema = z.strictObject({
  protocol: protocolSchema,
  connectionId: identifierSchema,
  sequence: z.number().int().positive(),
  sender: roleSchema,
  message: z.discriminatedUnion("kind", [
    requestSchema,
    responseSchema,
    eventSchema,
  ]),
});
const frameSchema = unsignedFrameSchema
  .extend({ mac: hex256BitSchema })
  .strict();
export type LocalControlFrame = z.infer<typeof frameSchema>;

export function signFrame(
  frame: z.input<typeof unsignedFrameSchema>,
  key: Uint8Array,
): LocalControlFrame {
  const parsed = unsignedFrameSchema.parse(frame);
  return { ...parsed, mac: calculateFrameMac(parsed, key).toString("hex") };
}

export function encodeFrame(frame: LocalControlFrame): Buffer {
  const payload = Buffer.from(canonicalJson(frameSchema.parse(frame)), "utf8");
  if (payload.byteLength > LOCAL_CONTROL_LIMITS.frameBytes) {
    throw new Error("frame exceeds byte bound");
  }
  const output = Buffer.allocUnsafe(4 + payload.byteLength);
  output.writeUInt32LE(payload.byteLength);
  payload.copy(output, 4);
  return output;
}

export function decodeFrame(bytes: Uint8Array): LocalControlFrame {
  const input = Buffer.from(bytes);
  if (input.byteLength < 4) {
    throw new Error("incomplete frame prefix");
  }
  const length = input.readUInt32LE(0);
  if (length > LOCAL_CONTROL_LIMITS.frameBytes) {
    throw new Error("frame exceeds byte bound");
  }
  if (input.byteLength !== length + 4) {
    throw new Error("incomplete frame or trailing data");
  }

  let value: unknown;
  try {
    value = JSON.parse(input.subarray(4).toString("utf8"));
  } catch {
    throw new Error("frame is not UTF-8 JSON");
  }
  enforceValueBounds(value);
  return frameSchema.parse(value);
}

export class FrameReceiver {
  #nextSequence = 1;

  constructor(
    private readonly connectionId: string,
    private readonly peerRole: LocalControlRole,
    private readonly key: Uint8Array,
  ) {}

  accept(encoded: Uint8Array): LocalControlFrame {
    const frame = decodeFrame(encoded);
    if (frame.connectionId !== this.connectionId) {
      throw new Error("wrong connection");
    }
    if (frame.sender !== this.peerRole) {
      throw new Error("wrong role");
    }
    if (frame.sequence < this.#nextSequence) {
      throw new Error("replayed sequence");
    }
    if (frame.sequence > this.#nextSequence) {
      throw new Error("sequence gap");
    }

    const { mac, ...unsigned } = frame;
    const expected = calculateFrameMac(unsigned, this.key);
    const actual = Buffer.from(mac, "hex");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new Error("invalid frame MAC");
    }

    this.#nextSequence += 1;
    return frame;
  }
}

export const invocationSchema = z.strictObject({
  invocationId: identifierSchema,
  policyOwner: z.enum([
    "launcher",
    "daemon",
    "maintenance",
    "source-driver",
  ]),
  operation: identifierSchema,
  argumentsDigest: hex256BitSchema,
});
export const sourceUpdateActivationSchema = z.strictObject({
  invocationId: identifierSchema,
  releaseId: z.string().regex(/^sha256-[a-f0-9]{64}$/),
  closureSha256: hex256BitSchema,
}).superRefine((value, context) => {
  if (value.releaseId !== `sha256-${value.closureSha256}`) {
    context.addIssue({ code: "custom", path: ["closureSha256"], message: "closure fingerprint must match release identity" });
  }
});
export const operationReceiptSchema = z.strictObject({
  invocationId: identifierSchema,
  operationId: identifierSchema,
  phase: identifierSchema,
  state: z.enum(["accepted", "running", "succeeded", "failed", "cancelled"]),
  cancellable: z.boolean(),
});
export const progressSchema = z.strictObject({
  operationId: identifierSchema,
  sequence: z.number().int().nonnegative(),
  phase: identifierSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive().optional(),
  messageCode: identifierSchema,
});
export const cancellationSchema = z.strictObject({
  operationId: identifierSchema,
  expectedPhase: identifierSchema,
});

export const secretOutputPolicy = Object.freeze({
  allowedInputs: ["hidden-console", "inherited-secret-handle"],
  allowedOutputs: ["interactive-console", "inherited-secret-handle"],
  forbidden: [
    "stdin",
    "argv",
    "environment",
    "config",
    "json",
    "redirected-stdout",
    "receipt",
    "log",
    "diagnostic",
    "support-bundle",
  ],
});

export function assertCompatible(
  local: z.input<typeof compatibilitySchema>,
  remote: z.input<typeof compatibilitySchema>,
  understood: ReadonlySet<string>,
): void {
  const parsedLocal = compatibilitySchema.parse(local);
  const parsedRemote = compatibilitySchema.parse(remote);

  if (parsedLocal.generation !== parsedRemote.generation) {
    throw new Error("incompatible local-control generation");
  }
  for (const semantic of parsedRemote.requiredSemantics) {
    if (!understood.has(semantic)) {
      throw new Error(`unknown required semantic: ${semantic}`);
    }
  }
}

function enforceValueBounds(value: unknown): void {
  if (
    typeof value === "string" &&
    value.length > LOCAL_CONTROL_LIMITS.stringCharacters
  ) {
    throw new Error("string exceeds bound");
  }
  if (Array.isArray(value)) {
    if (value.length > LOCAL_CONTROL_LIMITS.collectionItems) {
      throw new Error("collection exceeds bound");
    }
    for (const child of value) {
      enforceValueBounds(child);
    }
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > LOCAL_CONTROL_LIMITS.collectionItems) {
      throw new Error("collection exceeds bound");
    }
    for (const [, child] of entries) {
      enforceValueBounds(child);
    }
  }
}

function calculateFrameMac(
  frame: z.output<typeof unsignedFrameSchema>,
  key: Uint8Array,
): Buffer {
  return createHmac("sha256", key).update(canonicalJson(frame)).digest();
}
