import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompatible,
  authenticationProof,
  authenticationTranscript,
  cancellationSchema,
  deriveConnectionKey,
  encodeFrame,
  FrameReceiver,
  invocationSchema,
  LOCAL_CONTROL_LIMITS,
  LocalControlAdmission,
  OneUseChildBootstrap,
  operationReceiptSchema,
  progressSchema,
  secretOutputPolicy,
  signFrame,
  type LocalControlFrame,
} from "../packages/local-control/src/index.js";

const compatibility = { generation: 1, requiredSemantics: ["receipts-v1"] };
const client = {
  protocol: "pidex-local-control-v1" as const,
  instanceId: "instance",
  connectionId: "connection",
  role: "cli" as const,
  nonce: "11".repeat(32),
  compatibility,
};
const server = {
  ...client,
  role: "launcher" as const,
  nonce: "22".repeat(32),
};
const vectorKey = Buffer.from("00".repeat(32), "hex");

function createSignedFrame(
  key: Uint8Array,
  sequence: number,
  sender: "cli" | "daemon" = "cli",
  payload: unknown = null,
): LocalControlFrame {
  return signFrame(
    {
      protocol: "pidex-local-control-v1",
      connectionId: "connection",
      sequence,
      sender,
      message: {
        kind: "request",
        requestId: "r",
        method: "status",
        payload,
      },
    },
    key,
  );
}

function acceptFrame(key: Uint8Array, frame: LocalControlFrame): void {
  new FrameReceiver("connection", "cli", key).accept(encodeFrame(frame));
}

test("shared authentication vector binds roles and derives stable HKDF-SHA-256 bytes", () => {
  const transcript = authenticationTranscript(client, server);
  const key = deriveConnectionKey(vectorKey, client, server);
  assert.equal(
    key.toString("hex"),
    "13da8e60c5511210661414244c0fbaef7471886750d2606e7d195e8361993f4d",
  );
  assert.equal(
    authenticationProof(key, "client", transcript),
    "115821e70d9984728cc69d397bf3a4056219b1164071b5a65df6f39f006d344d",
  );
  assert.throws(
    () =>
      authenticationTranscript({ ...client, role: "daemon" }, server),
    /role/,
  );
});

test("shared invocation, receipt, progress, and cancellation contracts are strict", () => {
  const invocation = invocationSchema.parse({
    invocationId: "i",
    policyOwner: "daemon",
    operation: "backup",
    argumentsDigest: "aa".repeat(32),
  });
  assert.equal(invocation.invocationId, "i");

  operationReceiptSchema.parse({
    invocationId: "i",
    operationId: "o",
    phase: "copy",
    state: "running",
    cancellable: true,
  });
  progressSchema.parse({
    operationId: "o",
    sequence: 1,
    phase: "copy",
    completed: 1,
    total: 2,
    messageCode: "copying",
  });
  cancellationSchema.parse({
    operationId: "o",
    expectedPhase: "copy",
  });

  assert.throws(
    () =>
      operationReceiptSchema.parse({
        invocationId: "i",
        operationId: "o",
        phase: "x",
        state: "running",
        cancellable: true,
        futureMeaning: true,
      }),
    /Unrecognized/,
  );
  assert.ok(secretOutputPolicy.forbidden.includes("json"));
});

test("sequenced authenticated frames reject replay, gaps, wrong roles, MACs, and message kinds", () => {
  const key = deriveConnectionKey(vectorKey, client, server);
  const receiver = new FrameReceiver("connection", "cli", key);
  receiver.accept(encodeFrame(createSignedFrame(key, 1)));

  assert.throws(
    () => receiver.accept(encodeFrame(createSignedFrame(key, 1))),
    /replayed/,
  );
  assert.throws(
    () => acceptFrame(key, createSignedFrame(key, 2)),
    /gap/,
  );
  assert.throws(
    () => acceptFrame(key, createSignedFrame(key, 1, "daemon")),
    /role/,
  );

  const frameWithInvalidMac = createSignedFrame(key, 1);
  frameWithInvalidMac.mac = "00".repeat(32);
  assert.throws(
    () => acceptFrame(key, frameWithInvalidMac),
    /MAC/,
  );
  assert.throws(
    () =>
      signFrame(
        {
          protocol: "pidex-local-control-v1",
          connectionId: "connection",
          sequence: 1,
          sender: "cli",
          message: { kind: "future" } as never,
        },
        key,
      ),
    /Invalid/,
  );
});

test("compatibility requires a matching generation and understood semantics", () => {
  assert.throws(
    () =>
      assertCompatible(
        compatibility,
        { generation: 2, requiredSemantics: ["receipts-v1"] },
        new Set(["receipts-v1"]),
      ),
    /generation/,
  );
  assert.throws(
    () =>
      assertCompatible(
        compatibility,
        { generation: 1, requiredSemantics: ["future-v2"] },
        new Set(["receipts-v1"]),
      ),
    /unknown required/,
  );
});

test("frames enforce encoded byte and decoded value bounds", () => {
  const key = deriveConnectionKey(vectorKey, client, server);
  const oversizedFrame = createSignedFrame(
    key,
    1,
    "cli",
    "x".repeat(LOCAL_CONTROL_LIMITS.frameBytes),
  );
  assert.throws(() => encodeFrame(oversizedFrame), /frame exceeds byte bound/);

  const oversizedStringFrame = createSignedFrame(
    key,
    1,
    "cli",
    "x".repeat(LOCAL_CONTROL_LIMITS.stringCharacters + 1),
  );
  assert.throws(
    () => acceptFrame(key, oversizedStringFrame),
    /string exceeds bound/,
  );

  const oversizedCollectionFrame = createSignedFrame(
    key,
    1,
    "cli",
    Array.from(
      { length: LOCAL_CONTROL_LIMITS.collectionItems + 1 },
      () => null,
    ),
  );
  assert.throws(
    () => acceptFrame(key, oversizedCollectionFrame),
    /collection exceeds bound/,
  );
});

test("local peers are authenticated before any request is routed", () => {
  let routed = 0;
  const admission = new LocalControlAdmission({
    instanceId: "instance",
    owningSid: "S-1-5-21-1",
    allowedRoles: ["cli"],
  });
  const validPeer = {
    local: true,
    sid: "S-1-5-21-1",
    elevated: true,
    appContainer: false,
    instanceId: "instance",
    role: "cli" as const,
  };

  for (const peer of [
    { ...validPeer, local: false },
    { ...validPeer, sid: "S-1-5-21-2" },
    { ...validPeer, elevated: false },
    { ...validPeer, appContainer: true },
    { ...validPeer, instanceId: "other" },
    { ...validPeer, role: "daemon" as const },
  ]) {
    assert.throws(() => admission.route(peer, () => routed++), /rejected/);
  }
  assert.equal(routed, 0);
  assert.equal(admission.route(validPeer, () => ++routed), 1);
});

test("child bootstrap is one-use and binds process, role, release, config, and protocol", () => {
  const bootstraps = new OneUseChildBootstrap();
  const identity = {
    processId: 421,
    role: "daemon" as const,
    instanceId: "instance",
    releaseId: "release-1",
    configId: "config-1",
    protocol: "pidex-local-control-v1" as const,
  };
  const nonce = bootstraps.issue(identity);
  let routed = 0;

  assert.throws(
    () =>
      bootstraps.authenticate(
        nonce,
        { ...identity, processId: 422 },
        () => routed++,
      ),
    /rejected/,
  );
  assert.equal(routed, 0);
  assert.throws(
    () => bootstraps.authenticate(nonce, identity, () => routed++),
    /rejected/,
  );

  const freshNonce = bootstraps.issue(identity);
  assert.equal(
    bootstraps.authenticate(freshNonce, identity, () => ++routed),
    1,
  );
  assert.throws(
    () => bootstraps.authenticate(freshNonce, identity, () => routed++),
    /rejected/,
  );
});
