import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore } from "../packages/host/src/store.js";

test("Interaction ordering and revision reservation serialize competing terminal outcomes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-interaction-races-"));
  const store = new AuthorityStore(
    join(dataDir, "authority.sqlite"),
    adaptersFor("deterministic"),
  );

  try {
    const session = store.createSession(null, null, 1).session;
    const submitted = store.submitRun(
      "test device",
      {
        commandId: "run",
        sessionId: session.sessionId,
        prompt: "prompt",
        requiredCapability: "run.submit",
      },
      2,
    );
    assert.equal(submitted.kind, "accepted");
    if (submitted.kind !== "accepted") {
      throw new Error("missing accepted run");
    }

    const createInteraction = (
      correlationId: string,
      createdAt: number,
      deadlineAt: number | null,
    ) => store.createInteraction({
      sessionId: session.sessionId,
      runId: submitted.run.runId,
      workerGeneration: 1,
      correlationId,
      kind: "input",
      payload: { message: correlationId },
      createdAt,
      deadlineAt,
    }).interaction;

    const untimedFirst = createInteraction("untimed-first", 10, null);
    const timedLater = createInteraction("timed-later", 30, 50);
    const timedFirst = createInteraction("timed-first", 40, 45);
    const untimedLater = createInteraction("untimed-later", 20, null);

    assert.deepEqual(
      store.interactions(session.sessionId).map(item => item.interactionId),
      [
        timedFirst.interactionId,
        timedLater.interactionId,
        untimedFirst.interactionId,
        untimedLater.interactionId,
      ],
    );

    const reserved = store.reserveInteraction(
      timedFirst.interactionId,
      timedFirst.revision,
      "first device",
    );
    assert.equal(reserved?.state, "resolving");
    assert.equal(reserved?.revision, 2);
    assert.equal(reserved?.respondingDeviceLabel, "first device");
    assert.equal(
      store.reserveInteraction(
        timedFirst.interactionId,
        timedFirst.revision,
        "second device",
      ),
      undefined,
    );

    const responded = store.settleInteraction(
      timedFirst.interactionId,
      "resolving",
      "responded",
      "device-response",
      42,
      true,
    );
    assert.equal(responded?.state, "responded");
    assert.equal(responded?.revision, 3);
    assert.equal(responded?.terminalCause, "device-response");
    assert.equal(responded?.respondedAt, 42);
    assert.equal(responded?.applicationProven, true);
    assert.equal(
      store.settleInteraction(
        timedFirst.interactionId,
        "resolving",
        "withdrawn",
        "worker-lost",
        43,
        false,
      ),
      undefined,
    );

    const expired = store.settleInteraction(
      timedLater.interactionId,
      "open",
      "expired",
      "deadline",
      50,
      false,
    );
    assert.equal(expired?.state, "expired");
    assert.equal(expired?.terminalCause, "deadline");
    assert.equal(expired?.applicationProven, false);
    assert.deepEqual(
      store.interactions(session.sessionId).map(item => item.interactionId),
      [untimedFirst.interactionId, untimedLater.interactionId],
    );
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
