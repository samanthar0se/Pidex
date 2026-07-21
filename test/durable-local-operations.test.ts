import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableOperationRouter } from "../packages/launcher/src/operations.js";

async function withOperationJournal(
  run: (journalPath: string) => Promise<void> | void,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pidex-operation-"));
  const journalPath = join(directory, "operations.jsonl");
  try {
    await run(journalPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("exact invocation retries return the durably accepted operation receipt", async () => {
  await withOperationJournal(journalPath => {
    const invocation = {
      invocationId: "invocation-1",
      policyOwner: "daemon" as const,
      operation: "backup",
      argumentsDigest: "ab".repeat(32),
    };
    const firstRouter = new DurableOperationRouter(journalPath);
    const accepted = firstRouter.accept(invocation, {
      phase: "queued",
      cancellable: false,
    });

    const restartedRouter = new DurableOperationRouter(journalPath);
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
  });
});

test("progress, follow, cancellation, and reconnect reconcile operation state", async () => {
  await withOperationJournal(journalPath => {
    const router = new DurableOperationRouter(journalPath);
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

    const reconnected = new DurableOperationRouter(journalPath);
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
  });
});

test("accepted work routes to its exact policy owner independently of the caller", async () => {
  let finishSelectedRoute: (() => void) | undefined;
  const selectedRouteBlocked = new Promise<void>(resolve => {
    finishSelectedRoute = resolve;
  });
  const invokedPolicyOwners: string[] = [];
  await withOperationJournal(async journalPath => {
    const router = new DurableOperationRouter(journalPath);
    const receipt = router.route(
      {
        invocationId: "invocation-3",
        policyOwner: "source-driver",
        operation: "build-source-closure",
        argumentsDigest: "12".repeat(32),
      },
      { phase: "accepted", cancellable: false },
      {
        launcher: () => { invokedPolicyOwners.push("launcher"); },
        daemon: () => { invokedPolicyOwners.push("daemon"); },
        maintenance: () => { invokedPolicyOwners.push("maintenance"); },
        "source-driver": async () => {
          invokedPolicyOwners.push("source-driver");
          await selectedRouteBlocked;
        },
      },
    );

    assert.deepEqual(
      new DurableOperationRouter(journalPath).lookup(receipt.operationId),
      receipt,
    );
    finishSelectedRoute?.();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(invokedPolicyOwners, ["source-driver"]);
  });
});
