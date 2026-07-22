import assert from "node:assert/strict";
import test from "node:test";
import {
  IndexedDbWorkingSetStorage,
  OfflineWorkingSet,
  workingSetKey,
} from "../apps/client/src/offline-working-set.js";

const basis = {
  origin: "http://pidex.test:7443",
  hostId: "host-one",
  cacheSchema: 1,
  protocol: "1.2",
  synchronizationEpoch: "epoch-one",
};

test("storage identity includes origin, Host, cache schema, protocol, and synchronization epoch", () => {
  assert.equal(
    workingSetKey(basis),
    "http%3A%2F%2Fpidex.test%3A7443|host-one|1|1.2|epoch-one",
  );
});

test("matching continuity exposes stale read-only facts while keeping drafts editable", () => {
  const workingSet = new OfflineWorkingSet({
    basis,
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "session-one", name: "Cached" }] },
    drafts: { "session-one": "continue here" },
  });

  assert.deepEqual(workingSet.offline(basis), {
    availability: "stale",
    completeness: "incomplete",
    mutability: "read-only",
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "session-one", name: "Cached" }] },
    drafts: { "session-one": "continue here" },
  });
});

test("a different Host removes reached facts and quarantines associated drafts", () => {
  const workingSet = new OfflineWorkingSet({
    basis,
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "session-one", name: "Old Host" }] },
    drafts: { "session-one": "do not reassociate" },
  });

  assert.deepEqual(workingSet.reach({ ...basis, hostId: "host-two", synchronizationEpoch: "epoch-two" }), {
    kind: "different-host",
    facts: undefined,
    quarantinedDrafts: { "session-one": "do not reassociate" },
    commandsEnabled: false,
  });
});

test("a missing reached cursor resets otherwise matching continuity", () => {
  const workingSet = new OfflineWorkingSet({
    basis: { ...basis, cursor: "cursor-old" },
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "old", name: "Do not reuse" }] },
    drafts: { old: "preserve me" },
  });

  assert.deepEqual(workingSet.reach(basis), {
    kind: "continuity-reset",
    facts: undefined,
    drafts: { old: "preserve me" },
    commandsEnabled: false,
  });
});

test("missing reached resource revisions reset otherwise matching continuity", () => {
  const workingSet = new OfflineWorkingSet({
    basis: { ...basis, resourceRevisions: { discovery: 3 } },
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "old", name: "Do not reuse" }] },
    drafts: { old: "preserve me" },
  });

  assert.deepEqual(workingSet.reach(basis), {
    kind: "continuity-reset",
    facts: undefined,
    drafts: { old: "preserve me" },
    commandsEnabled: false,
  });
});

test("Host facts cannot be committed without synchronization barrier proof", () => {
  const workingSet = new OfflineWorkingSet({
    basis,
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "old", name: "Keep until proven" }] },
    drafts: { old: "preserve me" },
  });
  assert.throws(
    () => workingSet.commitAfterBarrier(
      basis,
      undefined as never,
      { sessions: [] },
      "2026-07-22T11:00:00.000Z",
    ),
    /synchronization barrier/i,
  );
});

test("mismatched synchronization barriers cannot commit Host facts", () => {
  const workingSet = new OfflineWorkingSet({
    basis,
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "old", name: "Keep until proven" }] },
    drafts: { old: "preserve me" },
  });
  const reached = { ...basis, cursor: "cursor-new", resourceRevisions: { discovery: 4 } };
  const mismatchedBarriers = [
    { cursor: "cursor-new", resourceRevisions: { discovery: 4 }, protocolBasis: "1.1" },
    { cursor: "cursor-old", resourceRevisions: { discovery: 4 }, protocolBasis: "1.2" },
    { cursor: "cursor-new", resourceRevisions: { discovery: 3 }, protocolBasis: "1.2" },
  ];

  for (const barrier of mismatchedBarriers) {
    assert.throws(
      () => workingSet.commitAfterBarrier(reached, barrier, { sessions: [] }, "2026-07-22T11:00:00.000Z"),
      /synchronization barrier/i,
    );
  }
});

test("explicit storage rejects records that omit their synchronization barrier basis", async () => {
  const storage = new IndexedDbWorkingSetStorage<{ sessions: never[] }, Record<string, string>>();

  await assert.rejects(
    storage.writeAfterBarrier(
      {
        basis,
        lastSynchronizedAt: "2026-07-22T11:00:00.000Z",
        facts: { sessions: [] },
        drafts: {},
      },
      { cursor: "cursor-new", resourceRevisions: {}, protocolBasis: "1.2" },
    ),
    /does not include its synchronization barrier basis/i,
  );
});

test("incompatible same-Host continuity replaces facts only after a fresh synchronization barrier", () => {
  const workingSet = new OfflineWorkingSet({
    basis: { ...basis, cursor: "cursor-old", resourceRevisions: { discovery: 3 } },
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "old", name: "Replace me" }] },
    drafts: { old: "preserve me" },
  });
  const reached = {
    ...basis,
    synchronizationEpoch: "epoch-two",
    cursor: "cursor-new",
    resourceRevisions: {},
  };
  const barrier = {
    cursor: "cursor-new",
    resourceRevisions: {},
    protocolBasis: "1.2",
  };

  assert.deepEqual(workingSet.reach(reached), {
    kind: "continuity-reset", facts: undefined, drafts: { old: "preserve me" }, commandsEnabled: false,
  });
  assert.equal(
    workingSet.commitAfterBarrier(reached, barrier, { sessions: [] }, "2026-07-22T11:00:00.000Z").commandsEnabled,
    true,
  );
  assert.deepEqual(workingSet.offline(reached)?.facts, { sessions: [] });
  assert.deepEqual(workingSet.offline(reached)?.drafts, { old: "preserve me" });
});
