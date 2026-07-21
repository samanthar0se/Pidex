import assert from "node:assert/strict";
import test from "node:test";
import {
  createClientStore,
  selectDiscoveryGroups,
  selectCurrentSession,
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
