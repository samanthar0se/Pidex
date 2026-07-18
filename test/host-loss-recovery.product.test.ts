import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityStore } from "../packages/host/src/store.js";

test("Host restart conservatively converges all Sessions without rotating continuity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-host-loss-"));
  const databasePath = join(root, "authority.sqlite");
  const adapters = adaptersFor("deterministic");
  try {
    let store = new AuthorityStore(databasePath, adapters);
    const initialStatus = store.status("test");
    const interruptedSession = store.createSession(null, null, 1).session;
    const completedSession = store.createSession(null, null, 2).session;
    const interruptedRun = store.submitRun(
      "device",
      {
        commandId: "uncertain",
        sessionId: interruptedSession.sessionId,
        prompt: "one",
        requiredCapability: "run.submit",
      },
      3,
    );
    assert.equal(interruptedRun.kind, "accepted");

    const completedRun = store.submitRun(
      "device",
      {
        commandId: "proved",
        sessionId: completedSession.sessionId,
        prompt: "two",
        requiredCapability: "run.submit",
      },
      4,
    );
    assert.equal(completedRun.kind, "accepted");
    if (completedRun.kind !== "accepted") {
      throw new Error("missing run");
    }
    store.stageCompletionEvidence(
      completedRun.run.runId,
      "durable result",
      "checkpoint",
    );
    store.close(); // simulated power loss boundary after durable writes

    store = new AuthorityStore(databasePath, adapters);
    store.reconcileAcceptedRuns(5);
    assert.equal(
      store.runs(interruptedSession.sessionId)[0]?.state,
      "interrupted",
    );
    assert.equal(
      store.runs(completedSession.sessionId)[0]?.state,
      "completed",
    );
    assert.equal(
      store.timeline(completedSession.sessionId).at(-1)?.text,
      "durable result",
    );
    assert.equal(store.status("test").hostId, initialStatus.hostId);
    assert.equal(
      store.status("test").synchronization.epoch,
      initialStatus.synchronization.epoch,
    );
    assert.equal(store.acceptedRuns().length, 0);
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Host restart interrupts an unproved cancellation instead of assuming success", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-host-loss-"));
  const databasePath = join(root, "authority.sqlite");
  const adapters = adaptersFor("deterministic");
  try {
    let store = new AuthorityStore(databasePath, adapters);
    const session = store.createSession(null, null, 1).session;
    const submittedRun = store.submitRun(
      "device",
      {
        commandId: "run",
        sessionId: session.sessionId,
        prompt: "one",
        requiredCapability: "run.submit",
      },
      2,
    );
    assert.equal(submittedRun.kind, "accepted");
    if (submittedRun.kind !== "accepted") {
      throw new Error("missing run");
    }
    const observedSession = store.projection().sessions.find(
      candidate => candidate.sessionId === session.sessionId,
    );
    if (!observedSession) {
      throw new Error("missing session");
    }

    const stopResult = store.acceptStop(
      "device",
      {
        commandId: "stop",
        sessionId: session.sessionId,
        runId: submittedRun.run.runId,
        workerGeneration: "worker-1",
        observedState: "executing",
        observedTimelineRevision: observedSession.timelineRevision,
      },
      "worker-1",
      3,
    );
    assert.equal(stopResult.kind, "accepted");
    store.close();

    store = new AuthorityStore(databasePath, adapters);
    store.reconcileAcceptedRuns(4);

    assert.equal(store.runs(session.sessionId)[0]?.state, "interrupted");
    assert.equal(
      store.timeline(session.sessionId).at(-1)?.text,
      "Host recovery interrupted an unproved cancellation. Partial output and committed side effects were preserved.",
    );
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
