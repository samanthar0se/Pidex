import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableOperationRouter } from "../packages/launcher/src/operations.js";

test("exact invocation retries return the durably accepted operation receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pidex-operations-"));
  const journal = join(directory, "operations.jsonl");
  const invocation = {
    invocationId: "invocation-1",
    policyOwner: "daemon" as const,
    operation: "backup",
    argumentsDigest: "ab".repeat(32),
  };

  try {
    const firstRouter = new DurableOperationRouter(journal);
    const accepted = firstRouter.accept(invocation, {
      phase: "queued",
      cancellable: false,
    });

    const restartedRouter = new DurableOperationRouter(journal);
    assert.deepEqual(
      restartedRouter.accept(invocation, {
        phase: "ignored-on-retry",
        cancellable: true,
      }),
      accepted,
    );
    assert.deepEqual(restartedRouter.lookup(accepted.operationId), accepted);
    assert.throws(
      () =>
        restartedRouter.accept(
          { ...invocation, argumentsDigest: "cd".repeat(32) },
          { phase: "queued", cancellable: false },
        ),
      /invocation-id-conflict/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("progress, follow, cancellation, and reconnect reconcile operation state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pidex-operation-follow-"));
  const journal = join(directory, "operations.jsonl");
  try {
    const router = new DurableOperationRouter(journal);
    const accepted = router.accept(
      {
        invocationId: "invocation-2",
        policyOwner: "maintenance",
        operation: "restore",
        argumentsDigest: "ef".repeat(32),
      },
      { phase: "validate", cancellable: true },
    );
    router.progress({
      operationId: accepted.operationId,
      sequence: 0,
      phase: "validate",
      completed: 1,
      total: 2,
      messageCode: "archive-validated",
    });
    assert.equal(
      router.cancel({
        operationId: accepted.operationId,
        expectedPhase: "validate",
      }).state,
      "cancelled",
    );

    const reconnected = new DurableOperationRouter(journal);
    assert.deepEqual(reconnected.follow(accepted.operationId), {
      receipt: {
        ...accepted,
        state: "cancelled",
        cancellable: false,
      },
      progress: [
        {
          operationId: accepted.operationId,
          sequence: 0,
          phase: "validate",
          completed: 1,
          total: 2,
          messageCode: "archive-validated",
        },
      ],
    });
    assert.throws(
      () =>
        reconnected.cancel({
          operationId: accepted.operationId,
          expectedPhase: "validate",
        }),
      /operation-not-cancellable/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepted work routes to its exact policy owner independently of the caller", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pidex-operation-route-"));
  const journal = join(directory, "operations.jsonl");
  let releaseRoute: (() => void) | undefined;
  const routed = new Promise<void>(resolve => {
    releaseRoute = resolve;
  });
  const calls: string[] = [];
  try {
    const router = new DurableOperationRouter(journal);
    const receipt = router.route(
      {
        invocationId: "invocation-3",
        policyOwner: "source-driver",
        operation: "build-source-closure",
        argumentsDigest: "12".repeat(32),
      },
      { phase: "accepted", cancellable: false },
      {
        launcher: () => { calls.push("launcher"); },
        daemon: () => { calls.push("daemon"); },
        maintenance: () => { calls.push("maintenance"); },
        "source-driver": async () => {
          calls.push("source-driver");
          await routed;
        },
      },
    );

    assert.deepEqual(new DurableOperationRouter(journal).lookup(receipt.operationId), receipt);
    releaseRoute?.();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ["source-driver"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
