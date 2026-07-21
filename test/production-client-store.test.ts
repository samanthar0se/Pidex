import assert from "node:assert/strict";
import test from "node:test";
import {
  createClientStore,
  selectDiscoveryGroups,
  selectCurrentSession,
  selectCurrentTimeline,
  selectDraft,
} from "../apps/client/src/client-store.js";

test("FX-COMP-01/06: New Session creates durable scope before accepting its initial Run", async () => {
  const commands: unknown[] = [];
  const drafts = new Map([["new-session", "keep this exact prompt"]]);
  const store = createClientStore({
    host: {
      async readSession() { throw new Error("not used"); },
      async createSession(command) {
        commands.push(command);
        return { kind: "accepted", session: {
          sessionId: "session_created", name: "New Session",
          metadataRevision: 1, timelineRevision: 0,
        } };
      },
      async submitRun(command) {
        commands.push(command);
        return { kind: "accepted" };
      },
    },
    drafts: {
      async read(key) { return drafts.get(key) ?? ""; },
      async write(key, value) { drafts.set(key, value); },
    },
    routing: { replace() {} },
    commandIds: (() => { let id = 0; return () => `command_${++id}`; })(),
  });

  await store.getState().openNewSession({ projectId: "project_one" });
  await store.getState().setNewSessionScope({ projectId: "project_one", workspaceId: "workspace_two" });
  await store.getState().submitNewSession();

  assert.deepEqual(commands, [
    { commandId: "command_1", projectId: "project_one", workspaceId: "workspace_two" },
    { commandId: "command_2", sessionId: "session_created", prompt: "keep this exact prompt" },
  ]);
  assert.deepEqual(store.getState().newSession?.progress, {
    phase: "run-finished", sessionId: "session_created", result: { kind: "accepted" },
  });
  assert.equal(store.getState().newSession?.draft, "keep this exact prompt");
});

test("FX-COMP-02/03 FX-STATE-03/05 FX-RESP-05/06: Composer commands retain the exact observed Run context", async () => {
  const commands: unknown[] = [];
  const store = createClientStore({
    host: {
      async readSession(sessionId) {
        return {
          session: { sessionId, name: "Exact work", metadataRevision: 1, timelineRevision: 12 },
          timeline: [],
          runs: [
            { runId: "run-exact", sessionId, sessionOrder: 1, prompt: "work", state: "executing", workerGeneration: "worker-7" },
            { runId: "run-held", sessionId, sessionOrder: 2, prompt: "later", state: "held" },
          ],
        };
      },
      async steerRun(command) { commands.push(command); return { kind: "accepted" }; },
      async stopRun(command) { commands.push(command); return { kind: "uncertain", reason: "transport-lost" }; },
      async actOnHeldRun(command) { commands.push(command); return { kind: "accepted" }; },
    },
    drafts: { async read() { return "also test"; }, async write() {} },
    routing: { replace() {} },
    commandIds: (() => { let id = 0; return () => `command-${++id}`; })(),
  });

  await store.getState().openSession("session-one");
  await store.getState().submitComposer();
  await store.getState().setDraft("");
  await store.getState().submitComposer();
  await store.getState().actOnHeldRun("run-held", "release");

  assert.deepEqual(commands, [
    { commandId: "command-1", sessionId: "session-one", runId: "run-exact", workerGeneration: "worker-7", observedTimelineRevision: 12, text: "also test" },
    { commandId: "command-2", sessionId: "session-one", runId: "run-exact", workerGeneration: "worker-7", observedState: "executing", observedTimelineRevision: 12 },
    { commandId: "command-3", runId: "run-held", action: "release" },
  ]);
  assert.equal(store.getState().drafts["session-one"], "");
  assert.deepEqual(store.getState().commandOutcomes.find(outcome => outcome.commandId === "command-2"), {
    commandId: "command-2", runId: "run-exact", action: "stop", phase: "uncertain", reason: "transport-lost",
  });
  assert.equal(store.getState().runs["session-one"]?.find(run => run.runId === "run-held")?.state, "executing");
});

test("FX-INT-02/04/05/06: Interaction resolution keeps authoritative order and exact identity without retaining plaintext", async () => {
  const commands: unknown[] = [];
  let publish: ((interactions: any[]) => void) | undefined;
  const first = interaction("first", "input", 2, 40, "run-one");
  const urgent = interaction("urgent", "editor", 7, 20, "run-one");
  const store = createClientStore({
    host: {
      async readSession(sessionId) {
        return {
          session: { sessionId, name: "Needs response", metadataRevision: 1, timelineRevision: 4 },
          timeline: [], runs: [], interactions: [urgent, first],
        };
      },
      watchInteractions(_sessionId, listener) { publish = listener; return () => {}; },
      async resolveInteraction(command) { commands.push(command); return { kind: "accepted" }; },
    },
    drafts: { async read() { return "preserve my draft"; }, async write() {} },
    routing: { replace() {} }, commandIds: () => "resolve-command",
  });

  await store.getState().openSession("session-one");
  await store.getState().resolveInteraction("urgent", { kind: "respond", value: "private response" });

  assert.deepEqual(commands, [{
    type: "interaction.resolve", commandId: "resolve-command", interactionId: "urgent",
    workerGeneration: 3, observedRevision: 7, dismiss: false, value: "private response",
  }]);
  assert.equal(store.getState().interactionIntents.urgent?.phase, "accepted-awaiting-projection");
  assert.equal(JSON.stringify(store.getState()).includes("private response"), false);
  assert.equal(selectDraft(store.getState()), "preserve my draft");
  assert.deepEqual(store.getState().interactions["session-one"]?.map(item => item.interactionId), ["urgent", "first"]);

  publish?.([{ ...urgent, state: "expired", revision: 8, terminalCause: "deadline" }, first]);
  assert.equal(store.getState().interactionIntents.urgent, undefined);
  assert.deepEqual(store.getState().interactions["session-one"]?.map(item => item.interactionId), ["first"]);
});

function interaction(id: string, kind: "input" | "editor", revision: number, deadlineAt: number, runId: string) {
  return {
    interactionId: id, sessionId: "session-one", runId, workerGeneration: 3,
    correlationId: `correlation-${id}`, kind, payload: { message: id }, state: "open" as const,
    revision, createdAt: deadlineAt - 5, deadlineAt, terminalCause: null, respondedAt: null,
    respondingDeviceLabel: null, applicationProven: null,
  };
}

test("Composer submission records no Run identity until the Host projects one", async () => {
  const store = createClientStore({
    host: {
      async readSession(sessionId) {
        return {
          session: { sessionId, name: "New work", metadataRevision: 1, timelineRevision: 3 },
          timeline: [],
          runs: [],
        };
      },
      async submitRun() { return { kind: "accepted" }; },
    },
    drafts: { async read() { return "start this"; }, async write() {} },
    routing: { replace() {} },
    commandIds: () => "command-submit",
  });

  await store.getState().openSession("session-one");
  await store.getState().submitComposer();

  assert.deepEqual(store.getState().composerCommand, {
    commandId: "command-submit",
    action: "submit",
    phase: "accepted-awaiting-projection",
  });
});

test("FX-RESP-01/02/03: partial and uncertain creation outcomes preserve the exact draft and prevent replay", async () => {
  let creates = 0;
  let submissions = 0;
  const store = createClientStore({
    host: {
      async readSession() { throw new Error("not used"); },
      async createSession() {
        creates++;
        return { kind: "accepted", session: {
          sessionId: "session_durable", name: "New Session", metadataRevision: 1, timelineRevision: 0,
        } };
      },
      async submitRun() { submissions++; return { kind: "uncertain", reason: "transport-lost" }; },
    },
    drafts: { async read() { return "do not duplicate"; }, async write() {} },
    routing: { replace() {} }, commandIds: () => `command_${creates + submissions}`,
  });
  await store.getState().openNewSession({ projectId: "project_exact" });
  await store.getState().submitNewSession();
  await store.getState().submitNewSession();

  assert.equal(creates, 1);
  assert.equal(submissions, 1);
  assert.deepEqual(store.getState().newSession, {
    projectId: "project_exact", draft: "do not duplicate", progress: {
      phase: "run-finished", sessionId: "session_durable",
      result: { kind: "uncertain", reason: "transport-lost" },
    },
  });
});

test("FX-DISC-02 FX-DISC-03 FX-DISC-04: discovery keeps authoritative Project and Chats hierarchy while searching", async () => {
  const store = createClientStore({
    host: {
      async readCatalog() {
        return {
          projects: [
            { projectId: "project-z", name: "Zeta" },
            { projectId: "project-a", name: "Alpha" },
          ],
          sessions: [
            session("second", "Fix search", "project-a", "working", "read"),
            session("first", "Release notes", "project-z", "quiet", "unread"),
            session("chat", "Search ideas", null, "needs-response", "unread"),
          ],
          archivedSessions: [],
        };
      },
      async readSession() { throw new Error("not used"); },
      async restoreSession() { throw new Error("not used"); },
    },
    drafts: { async read() { return ""; }, async write() {} },
    preferences: { async readExpandedProjects() { return []; }, async writeExpandedProjects() {} },
    routing: { push() {}, replace() {}, subscribe() { return () => {}; } },
  });

  await store.getState().loadDiscovery();
  store.getState().setSearchQuery("search");

  assert.deepEqual(selectDiscoveryGroups(store.getState()).map(group => ({
    name: group.name,
    sessions: group.sessions.map(item => ({
      id: item.sessionId, attention: item.attention, read: item.readState!.readStatus,
    })),
  })), [
    { name: "Alpha", sessions: [{ id: "second", attention: "working", read: "read" }] },
    { name: "Chats", sessions: [{ id: "chat", attention: "needs-response", read: "unread" }] },
  ]);
});

function session(
  sessionId: string,
  name: string,
  projectId: string | null,
  attention: "quiet" | "working" | "needs-response",
  readStatus: "read" | "unread",
) {
  return {
    sessionId, name, projectId, metadataRevision: 1, timelineRevision: 1,
    attention, readState: { readStatus, readStateRevision: 1, readThroughTimelineRevision: 1 },
  };
}

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

test("FX-STATE-01 FX-DISC-05 FX-DISC-06: expansion is Device-owned and Restore uses the exact archived revision", async () => {
  const writes: string[][] = [];
  const restores: Array<[string, number]> = [];
  const archived = session("old", "Old chat", null, "quiet", "read");
  archived.metadataRevision = 9;
  const store = createClientStore({
    host: {
      async readCatalog() { return { projects: [{ projectId: "p", name: "Project" }], sessions: [], archivedSessions: [archived] }; },
      async readSession() { throw new Error("not used"); },
      async restoreSession(item) { restores.push([item.sessionId, item.metadataRevision]); },
    },
    drafts: { async read() { return ""; }, async write() {} },
    preferences: {
      async readExpandedProjects() { return ["p"]; },
      async writeExpandedProjects(ids) { writes.push(ids); },
    },
    routing: { push() {}, replace() {}, subscribe() { return () => {}; } },
  });

  await store.getState().loadDiscovery();
  assert.deepEqual(store.getState().expandedProjectIds, ["p"]);
  await store.getState().toggleProject("p");
  assert.deepEqual(writes, [[]]);
  store.getState().setDiscoveryMode("archived");
  await store.getState().restoreSession("old");
  assert.deepEqual(restores, [["old", 9]]);
  assert.deepEqual(store.getState().archivedOrder, []);
  assert.deepEqual(store.getState().sessionOrder, ["old"]);
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

test("paging from a previously selected Session cannot leave the current Session loading or failed", async () => {
  for (const outcome of ["success", "failure"] as const) {
    let resolveOlderPage: ((result: { entries: []; olderCursor: null }) => void) | undefined;
    let rejectOlderPage: ((reason: Error) => void) | undefined;
    const olderPage = new Promise<{ entries: []; olderCursor: null }>((resolve, reject) => {
      resolveOlderPage = resolve;
      rejectOlderPage = reject;
    });
    const store = createClientStore({
      host: {
        async readSession(sessionId) {
          return {
            session: { sessionId, name: sessionId, metadataRevision: 1, timelineRevision: 1 },
            timeline: [],
            olderCursor: sessionId === "first" ? "older" : null,
          };
        },
        async readOlder() { return olderPage; },
      },
      drafts: { async read() { return ""; }, async write() {} },
      routing: { replace() {} },
    });

    await store.getState().openSession("first");
    const stalePaging = store.getState().loadOlder();
    assert.equal(store.getState().paging, "loading");

    await store.getState().openSession("second");
    if (outcome === "success") resolveOlderPage?.({ entries: [], olderCursor: null });
    else rejectOlderPage?.(new Error("Host unavailable"));
    await stalePaging;

    assert.equal(store.getState().selectedSessionId, "second");
    assert.equal(store.getState().paging, "idle");
  }
});
