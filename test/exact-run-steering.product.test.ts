import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import {
  AuthorityStore,
  type SteerCommand,
} from "../packages/host/src/store.js";

test("steering is durable, idempotent, and cannot cross an execution boundary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidex-steer-"));
  const store = new AuthorityStore(
    join(dir, "authority.sqlite"),
    adaptersFor("deterministic"),
  );
  try {
    const session = store.createSession(null, null, 1).session;
    const submitted = store.submitRun(
      "device",
      {
        commandId: "submit",
        sessionId: session.sessionId,
        prompt: "build",
        requiredCapability: "run.submit",
      },
      2,
    );
    assert.equal(submitted.kind, "accepted");
    if (submitted.kind !== "accepted") {
      throw new Error("run not accepted");
    }

    const projectedSession = store
      .projection()
      .sessions.find(item => item.sessionId === session.sessionId);
    assert.ok(projectedSession);
    const revision = projectedSession.timelineRevision;
    const command: SteerCommand = {
      commandId: "steer",
      sessionId: session.sessionId,
      runId: submitted.run.runId,
      workerGeneration: "worker-1",
      observedTimelineRevision: revision,
      text: "also run tests",
    };
    const accepted = store.acceptSteering("device", command, "worker-1", 3);
    assert.equal(accepted.kind, "accepted");
    const steeringEntry = store.timeline(session.sessionId).at(-1);
    assert.equal(steeringEntry?.kind, "steering");
    assert.equal(steeringEntry?.runId, submitted.run.runId);
    assert.equal(
      store.acceptSteering("device", command, "worker-1", 4).kind,
      "replayed",
    );

    store.settleRun(submitted.run.runId, "interrupted", "lost", null, 5);
    const stale = store.acceptSteering(
      "device",
      {
        ...command,
        commandId: "late",
        observedTimelineRevision: revision + 2,
      },
      "worker-1",
      6,
    );
    assert.equal(stale.kind, "rejected");
    assert.equal(
      store
        .timeline(session.sessionId)
        .filter(entry => entry.kind === "steering").length,
      1,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
