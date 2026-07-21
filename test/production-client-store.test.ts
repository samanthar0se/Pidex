import assert from "node:assert/strict";
import test from "node:test";
import {
  createClientStore,
  selectCurrentSession,
  selectCurrentTimeline,
  selectDraft,
} from "../apps/client/src/client-store.js";

test("the Client resumes a routed Session from current Host facts and a Device draft", async () => {
  const routed: string[] = [];
  const drafts = new Map([["session_one", "keep this local"]]);
  const store = createClientStore({
    host: {
      async readSession(sessionId) {
        assert.equal(sessionId, "session_one");
        return {
          session: {
            sessionId,
            name: "Exact Host title",
            metadataRevision: 7,
            timelineRevision: 2,
          },
          timeline: [
            { entryId: "entry_1", kind: "prompt", text: "hello" },
            { entryId: "entry_2", kind: "assistant", text: "current answer" },
          ],
        };
      },
    },
    drafts: {
      async read(sessionId) { return drafts.get(sessionId) ?? ""; },
      async write(sessionId, value) { drafts.set(sessionId, value); },
    },
    routing: { replace(path) { routed.push(path); } },
  });

  await store.getState().openSession("session_one");

  assert.equal(selectCurrentSession(store.getState())?.name, "Exact Host title");
  assert.equal(selectDraft(store.getState()), "keep this local");
  assert.deepEqual(routed, ["/sessions/session_one"]);

  await store.getState().setDraft("edited on this Device");
  assert.equal(drafts.get("session_one"), "edited on this Device");
  assert.equal(selectCurrentSession(store.getState())?.metadataRevision, 7);
});

test("FX-TL-04/05 FX-STATE-02/04: live facts reconcile by identity and older pages prepend", async () => {
  let publish: ((change: any) => void) | undefined;
  const readThrough: number[] = [];
  const store = createClientStore({
    host: {
      async readSession(sessionId) {
        return {
          session: { sessionId, name: "Work", metadataRevision: 1, timelineRevision: 4 },
          timeline: [
            { entryId: "work", runId: "run", order: 2, kind: "assistant", text: "hel", revision: 1, finalized: false },
            { entryId: "answer", runId: "run", order: 3, kind: "response", text: "done", revision: 1, finalized: true },
          ],
          olderCursor: "before-2",
        };
      },
      watchSession(_sessionId, listener) { publish = listener; return () => { publish = undefined; }; },
      async readOlder(_sessionId, cursor) {
        assert.equal(cursor, "before-2");
        return {
          entries: [{ entryId: "prompt", runId: "run", order: 1, kind: "prompt", text: "fix it", revision: 1, finalized: true }],
          olderCursor: null,
        };
      },
      async markRead(_sessionId, revision) { readThrough.push(revision); },
    },
    drafts: { async read() { return ""; }, async write() {} },
    routing: { replace() {} },
  });

  await store.getState().openSession("session");
  publish?.({ baseRevision: 4, revision: 5, entry: { entryId: "work", runId: "run", order: 2, kind: "assistant", text: "hello", revision: 2, finalized: true } });
  publish?.({ baseRevision: 5, revision: 6, entry: { entryId: "answer", runId: "run", order: 3, kind: "response", text: "rewritten", revision: 2, finalized: true } });
  publish?.({ baseRevision: 6, revision: 7, entry: { entryId: "correction", runId: "run", order: 4, kind: "lifecycle", text: "Recovery preserved the final answer", revision: 1, finalized: true } });
  assert.deepEqual(selectCurrentTimeline(store.getState()).map(entry => entry.text), ["hello", "done", "Recovery preserved the final answer"]);

  await store.getState().loadOlder();
  assert.deepEqual(selectCurrentTimeline(store.getState()).map(entry => entry.entryId), ["prompt", "work", "answer", "correction"]);
  await store.getState().presentTail();
  assert.deepEqual(readThrough, [7]);
});
