import assert from "node:assert/strict";
import test from "node:test";
import { OfflineWorkingSet, workingSetKey } from "../apps/client/src/offline-working-set.js";

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

test("incompatible same-Host continuity replaces facts only after a fresh synchronization barrier", () => {
  const workingSet = new OfflineWorkingSet({
    basis: { ...basis, cursor: "cursor-old", resourceRevisions: { discovery: 3 } },
    lastSynchronizedAt: "2026-07-22T10:00:00.000Z",
    facts: { sessions: [{ sessionId: "old", name: "Replace me" }] },
    drafts: { old: "preserve me" },
  });
  const reached = { ...basis, synchronizationEpoch: "epoch-two", cursor: "cursor-new" };

  assert.deepEqual(workingSet.reach(reached), {
    kind: "continuity-reset", facts: undefined, drafts: { old: "preserve me" }, commandsEnabled: false,
  });
  assert.equal(workingSet.commitAfterBarrier(reached, { sessions: [] }, "2026-07-22T11:00:00.000Z").commandsEnabled, true);
  assert.deepEqual(workingSet.offline(reached)?.facts, { sessions: [] });
  assert.deepEqual(workingSet.offline(reached)?.drafts, { old: "preserve me" });
});
