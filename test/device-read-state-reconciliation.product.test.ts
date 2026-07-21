import assert from "node:assert/strict";
import test from "node:test";
import {
  installSessionReadState,
  reconcileSessionReadState,
} from "../apps/pwa/read-state.mjs";
import type { SessionReadState } from "../apps/pwa/read-state.mjs";

const read = (revision: number, position = revision): SessionReadState => ({
  readThroughTimelineRevision: position,
  readStatus: "read",
  readStateRevision: revision,
});

test("Device working set shares one monotonic canonical Session read state", () => {
  const catalog = { sessionId: "s1", readState: read(1) };
  const scoped = { session: { sessionId: "s1", readState: read(1) } };
  const workingSet = {
    sessions: [catalog],
    archivedSessions: [],
    scopes: new Map([["s1", scoped]]),
    readStates: new Map(),
  };

  installSessionReadState(workingSet, catalog);
  const advanced = reconcileSessionReadState(workingSet, "s1", read(3));
  assert.equal(advanced, "advanced");
  assert.strictEqual(catalog.readState, scoped.session.readState);
  assert.deepEqual(catalog.readState, read(3));

  assert.equal(
    reconcileSessionReadState(workingSet, "s1", read(2)),
    "stale",
  );
  assert.deepEqual(catalog.readState, read(3));
  assert.equal(
    reconcileSessionReadState(workingSet, "s1", read(3)),
    "unchanged",
  );
});

test("equal-revision divergence or malformed authority discards the projection", () => {
  for (const candidate of [
    { ...read(2), readStatus: "unread" },
    { readStatus: "read", readStateRevision: 3 },
    { ...read(2), locallyInferred: true },
  ]) {
    const workingSet = {
      sessions: [{ sessionId: "s1", readState: read(2) }],
      archivedSessions: [],
      scopes: new Map([["s1", {
        session: { sessionId: "s1", readState: read(2) },
      }]]),
      readStates: new Map([["s1", read(2)]]),
    };
    assert.equal(
      reconcileSessionReadState(workingSet, "s1", candidate),
      "inconsistent",
    );
    assert.deepEqual(workingSet.sessions, []);
    assert.equal(workingSet.scopes.has("s1"), false);
    assert.equal(workingSet.readStates.has("s1"), false);
  }
});

test("equal-revision divergence between catalog and scoped projections is rejected", () => {
  const catalog = { sessionId: "s1", readState: read(2) };
  const scopedReadState: SessionReadState = {
    ...read(2),
    readStatus: "unread",
  };
  const workingSet = {
    sessions: [catalog],
    archivedSessions: [],
    scopes: new Map([["s1", {
      session: { sessionId: "s1", readState: scopedReadState },
    }]]),
    readStates: new Map(),
  };

  assert.equal(
    installSessionReadState(workingSet, catalog),
    "inconsistent",
  );
  assert.deepEqual(workingSet.sessions, []);
  assert.equal(workingSet.scopes.has("s1"), false);
  assert.equal(workingSet.readStates.has("s1"), false);
});

test("a change for an unknown Session requests Host-scope reconciliation", () => {
  const workingSet = {
    sessions: [], archivedSessions: [], scopes: new Map(), readStates: new Map(),
  };
  assert.equal(
    reconcileSessionReadState(workingSet, "missing", read(2)),
    "missing",
  );
});
