import assert from "node:assert/strict";
import test from "node:test";
import { authenticationProof, authenticationTranscript, deriveConnectionKey, encodeFrame, FrameReceiver, signFrame, assertCompatible, invocationSchema, operationReceiptSchema, progressSchema, cancellationSchema, secretOutputPolicy } from "../packages/local-control/src/index.js";

const compatibility = { generation: 1, requiredSemantics: ["receipts-v1"] };
const client = { protocol: "pidex-local-control-v1" as const, instanceId: "instance", connectionId: "connection", role: "cli" as const, nonce: "11".repeat(32), compatibility };
const server = { ...client, role: "launcher" as const, nonce: "22".repeat(32) };
const vectorKey = Buffer.from("00".repeat(32), "hex");

test("shared authentication vector binds roles and derives stable HKDF-SHA-256 bytes", () => {
  const transcript = authenticationTranscript(client, server);
  const key = deriveConnectionKey(vectorKey, client, server);
  assert.equal(key.toString("hex"), "13da8e60c5511210661414244c0fbaef7471886750d2606e7d195e8361993f4d");
  assert.equal(authenticationProof(key, "client", transcript), "115821e70d9984728cc69d397bf3a4056219b1164071b5a65df6f39f006d344d");
  assert.throws(() => authenticationTranscript({ ...client, role: "daemon" }, server), /role/);
});

test("all local-control participants share strict receipts, progress, cancellation, and invocation contracts", () => {
  for (const participant of ["cli", "launcher", "daemon", "maintenance"]) {
    assert.equal(invocationSchema.parse({ invocationId: "i", policyOwner: "daemon", operation: "backup", argumentsDigest: "aa".repeat(32) }).invocationId, "i", participant);
    operationReceiptSchema.parse({ invocationId: "i", operationId: "o", phase: "copy", state: "running", cancellable: true });
    progressSchema.parse({ operationId: "o", sequence: 1, phase: "copy", completed: 1, total: 2, messageCode: "copying" });
    cancellationSchema.parse({ operationId: "o", expectedPhase: "copy" });
  }
  assert.throws(() => operationReceiptSchema.parse({ invocationId: "i", operationId: "o", phase: "x", state: "running", cancellable: true, futureMeaning: true }), /Unrecognized/);
  assert.ok(secretOutputPolicy.forbidden.includes("json"));
});

test("sequenced authenticated frames reject replay, gaps, wrong roles, MACs, bounds, and unknown semantics", () => {
  const key = deriveConnectionKey(vectorKey, client, server);
  const make = (sequence: number, sender: "cli" | "daemon" = "cli") => signFrame({ protocol: "pidex-local-control-v1", connectionId: "connection", sequence, sender, message: { kind: "request", requestId: "r", method: "status", payload: null } }, key);
  new FrameReceiver("connection", "cli", key).accept(encodeFrame(make(1)));
  const replay = new FrameReceiver("connection", "cli", key); replay.accept(encodeFrame(make(1))); assert.throws(() => replay.accept(encodeFrame(make(1))), /replayed/);
  assert.throws(() => new FrameReceiver("connection", "cli", key).accept(encodeFrame(make(2))), /gap/);
  assert.throws(() => new FrameReceiver("connection", "cli", key).accept(encodeFrame(make(1, "daemon"))), /role/);
  const bad = make(1); bad.mac = "00".repeat(32); assert.throws(() => new FrameReceiver("connection", "cli", key).accept(encodeFrame(bad)), /MAC/);
  assert.throws(() => signFrame({ protocol: "pidex-local-control-v1", connectionId: "connection", sequence: 1, sender: "cli", message: { kind: "future" } as never }, key), /Invalid/);
  assert.throws(() => assertCompatible(compatibility, { generation: 1, requiredSemantics: ["future-v2"] }, new Set(["receipts-v1"])), /unknown required/);
});
