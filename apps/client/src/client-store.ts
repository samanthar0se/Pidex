import { createStore, type StoreApi } from "zustand/vanilla";

export type SessionAttention = "quiet" | "working" | "needs-response";
export interface ProjectFact { projectId: string; name: string; }
export interface SessionFact {
  sessionId: string;
  name: string;
  projectId?: string | null;
  metadataRevision: number;
  timelineRevision: number;
  attention?: SessionAttention;
  readState?: { readStatus: "read" | "unread"; readStateRevision: number; readThroughTimelineRevision: number };
}
export type TimelineKind = "assistant" | "interaction" | "lifecycle" | "outcome" | "prompt" | "response" | "tool";
export interface TimelineFact {
  entryId: string;
  kind: TimelineKind;
  text: string;
  runId?: string | null;
  order?: number;
  revision?: number;
  finalized?: boolean;
  blobId?: string | null;
  toolCallId?: string | null;
}
export interface SessionProjection { session: SessionFact; timeline: TimelineFact[]; olderCursor?: string | null; }
export interface TimelineChange { baseRevision: number; revision: number; entry: TimelineFact }
export interface TimelinePage { entries: TimelineFact[]; olderCursor: string | null }
export interface DiscoveryProjection {
  projects: ProjectFact[];
  sessions: SessionFact[];
  archivedSessions: SessionFact[];
}
export interface DiscoveryGroup { id: string; name: string; sessions: SessionFact[]; }

export interface NewSessionScope { projectId?: string; workspaceId?: string }
export type CommandResult =
  | { kind: "accepted" }
  | { kind: "rejected"; reason: string }
  | { kind: "uncertain"; reason: string };
export type SessionCreateResult = CommandResult & { session?: SessionFact };
type FailedCommandResult = Exclude<CommandResult, { kind: "accepted" }>;
export type NewSessionProgress =
  | { phase: "editing"; reason?: string }
  | { phase: "creating" }
  | { phase: "creation-failed"; result: FailedCommandResult }
  | { phase: "session-created"; sessionId: string }
  | { phase: "submitting-run"; sessionId: string }
  | { phase: "run-finished"; sessionId: string; result: CommandResult };
export interface NewSessionState extends NewSessionScope {
  draft: string;
  progress: NewSessionProgress;
}

export interface ClientAdapters {
  host: {
    readCatalog?(): Promise<DiscoveryProjection>;
    readSession(sessionId: string): Promise<SessionProjection>;
    restoreSession?(session: SessionFact): Promise<void>;
    createSession?(command: { commandId: string } & NewSessionScope): Promise<SessionCreateResult>;
    submitRun?(command: { commandId: string; sessionId: string; prompt: string }): Promise<CommandResult>;
    watchSession?(sessionId: string, listener: (change: TimelineChange) => void): () => void;
    readOlder?(sessionId: string, cursor: string): Promise<TimelinePage>;
    markRead?(sessionId: string, timelineRevision: number): Promise<void>;
  };
  drafts: { read(sessionId: string): Promise<string>; write(sessionId: string, value: string): Promise<void>; };
  preferences?: {
    readExpandedProjects(): Promise<string[]>;
    writeExpandedProjects(projectIds: string[]): Promise<void>;
  };
  routing: {
    replace(path: string): void;
    push?(path: string): void;
    subscribe?(listener: (path: string) => void): () => void;
  };
  commandIds?: () => string;
}

export interface ClientState {
  selectedSessionId?: string;
  projects: readonly ProjectFact[];
  sessions: Readonly<Record<string, SessionFact>>;
  sessionOrder: readonly string[];
  archivedSessions: Readonly<Record<string, SessionFact>>;
  archivedOrder: readonly string[];
  timelines: Readonly<Record<string, readonly TimelineFact[]>>;
  olderCursors: Readonly<Record<string, string | null>>;
  paging: "idle" | "loading" | "error";
  drafts: Readonly<Record<string, string>>;
  expandedProjectIds: readonly string[];
  searchQuery: string;
  discoveryMode: "available" | "archived";
  isSessionCurrent: boolean;
  newSession?: NewSessionState;
  loadDiscovery(): Promise<void>;
  openSession(sessionId: string, history?: "push" | "replace" | "none"): Promise<void>;
  openNewSession(scope?: NewSessionScope): Promise<void>;
  setNewSessionScope(scope: NewSessionScope): Promise<void>;
  setNewSessionDraft(value: string): Promise<void>;
  submitNewSession(createEmpty?: boolean): Promise<void>;
  setDraft(value: string): Promise<void>;
  setSearchQuery(query: string): void;
  setDiscoveryMode(mode: "available" | "archived"): void;
  toggleProject(projectId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  loadOlder(): Promise<void>;
  presentTail(): Promise<void>;
}

export type ClientStore = StoreApi<ClientState>;

export function createClientStore(adapters: ClientAdapters): ClientStore {
  const commandId = adapters.commandIds ?? (() => crypto.randomUUID());
  return createStore<ClientState>((set, get) => ({
    projects: [], sessions: {}, sessionOrder: [], archivedSessions: {}, archivedOrder: [],
    timelines: {}, olderCursors: {}, paging: "idle", drafts: {}, expandedProjectIds: [], searchQuery: "", discoveryMode: "available",
    isSessionCurrent: false,
    async loadDiscovery() {
      if (!adapters.host.readCatalog) return;
      const [catalog, expanded] = await Promise.all([
        adapters.host.readCatalog(),
        adapters.preferences?.readExpandedProjects() ?? Promise.resolve([]),
      ]);
      set({
        projects: catalog.projects,
        sessions: byId(catalog.sessions), sessionOrder: catalog.sessions.map(item => item.sessionId),
        archivedSessions: byId(catalog.archivedSessions), archivedOrder: catalog.archivedSessions.map(item => item.sessionId),
        expandedProjectIds: expanded,
      });
    },
    async openNewSession(scope = {}) {
      const draft = await adapters.drafts.read("new-session");
      set({ selectedSessionId: undefined, newSession: { ...scope, draft, progress: { phase: "editing" } } });
      adapters.routing.replace("/new");
    },
    async setNewSessionScope(scope) {
      const current = get().newSession;
      if (!current || current.progress.phase !== "editing") return;
      set({ newSession: { ...current, ...scope } });
    },
    async setNewSessionDraft(value) {
      const current = get().newSession;
      if (!current || current.progress.phase !== "editing") return;
      set({ newSession: { ...current, draft: value } });
      await adapters.drafts.write("new-session", value);
    },
    async submitNewSession(createEmpty = false) {
      const initial = get().newSession;
      if (!initial || initial.progress.phase !== "editing" || !adapters.host.createSession) return;
      const prompt = initial.draft;
      if (!createEmpty && !prompt.trim()) {
        set({ newSession: { ...initial, progress: {
          phase: "editing", reason: "Enter a prompt or create an empty Session",
        } } });
        return;
      }
      set({ newSession: { ...initial, progress: { phase: "creating" } } });
      const created = await adapters.host.createSession({
        commandId: commandId(), projectId: initial.projectId, workspaceId: initial.workspaceId,
      });
      if (created.kind !== "accepted" || !created.session) {
        const reason = created.kind === "accepted" ? "Host accepted creation without a Session projection" : created.reason;
        const kind = created.kind === "uncertain" ? "uncertain" : "rejected";
        set({ newSession: { ...initial, progress: {
          phase: "creation-failed", result: { kind, reason },
        } } });
        return;
      }
      const sessionId = created.session.sessionId;
      const durable = { ...initial, progress: { phase: "session-created" as const, sessionId } };
      set(state => ({
        sessions: { ...state.sessions, [sessionId]: created.session! },
        newSession: durable,
      }));
      if (createEmpty) {
        adapters.routing.replace(`/sessions/${encodeURIComponent(sessionId)}`);
        return;
      }
      if (!adapters.host.submitRun) return;
      set({ newSession: { ...durable, progress: { phase: "submitting-run", sessionId } } });
      const submitted = await adapters.host.submitRun({ commandId: commandId(), sessionId, prompt });
      set({ newSession: { ...durable, progress: { phase: "run-finished", sessionId, result: submitted } } });
      if (submitted.kind === "accepted") adapters.routing.replace(`/sessions/${encodeURIComponent(sessionId)}`);
    },
    async openSession(sessionId, navigation = "replace") {
      set({ selectedSessionId: sessionId, isSessionCurrent: false, newSession: undefined, paging: "idle" });
      const path = `/sessions/${encodeURIComponent(sessionId)}`;
      if (navigation === "push") (adapters.routing.push ?? adapters.routing.replace)(path);
      else if (navigation === "replace") adapters.routing.replace(path);
      const [projection, draft] = await Promise.all([adapters.host.readSession(sessionId), adapters.drafts.read(sessionId)]);
      if (get().selectedSessionId !== sessionId) return;
      set(state => ({
        sessions: { ...state.sessions, [sessionId]: projection.session },
        timelines: { ...state.timelines, [sessionId]: projection.timeline },
        olderCursors: { ...state.olderCursors, [sessionId]: projection.olderCursor ?? null },
        drafts: { ...state.drafts, [sessionId]: draft }, isSessionCurrent: true,
      }));
      adapters.host.watchSession?.(sessionId, change => {
        if (get().selectedSessionId !== sessionId) return;
        set(state => {
          const session = state.sessions[sessionId];
          if (!session || change.baseRevision !== session.timelineRevision || change.revision <= session.timelineRevision) return state;
          const entries = [...(state.timelines[sessionId] ?? [])];
          const index = entries.findIndex(entry => entry.entryId === change.entry.entryId);
          if (index < 0) entries.push(change.entry);
          else {
            const current = entries[index]!;
            const currentEntryRevision = current.revision ?? 1;
            const incomingEntryRevision = change.entry.revision ?? 1;
            if (!current.finalized && incomingEntryRevision > currentEntryRevision) entries[index] = change.entry;
          }
          entries.sort(compareTimelineEntries);
          return {
            sessions: { ...state.sessions, [sessionId]: { ...session, timelineRevision: change.revision } },
            timelines: { ...state.timelines, [sessionId]: entries },
          };
        });
      });
    },
    async setDraft(value) {
      const sessionId = get().selectedSessionId;
      if (!sessionId) return;
      set(state => ({ drafts: { ...state.drafts, [sessionId]: value } }));
      await adapters.drafts.write(sessionId, value);
    },
    setSearchQuery(searchQuery) { set({ searchQuery }); },
    setDiscoveryMode(discoveryMode) {
      set({ discoveryMode, newSession: undefined });
      (adapters.routing.push ?? adapters.routing.replace)(discoveryMode === "archived" ? "/archived" : "/");
    },
    async toggleProject(projectId) {
      const expanded = get().expandedProjectIds;
      const expandedProjectIds = expanded.includes(projectId)
        ? expanded.filter(id => id !== projectId) : [...expanded, projectId];
      set({ expandedProjectIds });
      await adapters.preferences?.writeExpandedProjects(expandedProjectIds);
    },
    async restoreSession(sessionId) {
      const session = get().archivedSessions[sessionId];
      if (!session || !adapters.host.restoreSession) return;
      await adapters.host.restoreSession(session);
      set(state => ({
        archivedSessions: omit(state.archivedSessions, sessionId),
        archivedOrder: state.archivedOrder.filter(id => id !== sessionId),
        sessions: { ...state.sessions, [sessionId]: session },
        sessionOrder: [...state.sessionOrder, sessionId],
      }));
    },
    async loadOlder() {
      const state = get();
      const sessionId = state.selectedSessionId;
      const cursor = sessionId ? state.olderCursors[sessionId] : null;
      if (!sessionId || !cursor || !adapters.host.readOlder || state.paging === "loading") return;
      set({ paging: "loading" });
      try {
        const page = await adapters.host.readOlder(sessionId, cursor);
        if (get().selectedSessionId !== sessionId) return;
        set(current => ({
          timelines: { ...current.timelines, [sessionId]: mergeTimeline(page.entries, current.timelines[sessionId] ?? []) },
          olderCursors: { ...current.olderCursors, [sessionId]: page.olderCursor },
          paging: "idle",
        }));
      } catch {
        if (get().selectedSessionId === sessionId) set({ paging: "error" });
      }
    },
    async presentTail() {
      const state = get();
      const sessionId = state.selectedSessionId;
      const revision = sessionId ? state.sessions[sessionId]?.timelineRevision : undefined;
      if (sessionId && revision && state.isSessionCurrent) await adapters.host.markRead?.(sessionId, revision);
    },
  }));
}

function mergeTimeline(older: readonly TimelineFact[], current: readonly TimelineFact[]): TimelineFact[] {
  const entries = new Map([...older, ...current].map(entry => [entry.entryId, entry]));
  return [...entries.values()].sort(compareTimelineEntries);
}

function compareTimelineEntries(left: TimelineFact, right: TimelineFact): number {
  return (left.order ?? 0) - (right.order ?? 0);
}

function byId(items: SessionFact[]) { return Object.fromEntries(items.map(item => [item.sessionId, item])); }
function omit(items: Readonly<Record<string, SessionFact>>, id: string) {
  const next = { ...items }; delete next[id]; return next;
}

export function selectDiscoveryGroups(state: ClientState): DiscoveryGroup[] {
  const source = state.discoveryMode === "archived" ? state.archivedSessions : state.sessions;
  const order = state.discoveryMode === "archived" ? state.archivedOrder : state.sessionOrder;
  const query = state.searchQuery.trim().toLocaleLowerCase();
  const matches = (session: SessionFact, groupName: string) =>
    !query || `${session.name} ${groupName}`.toLocaleLowerCase().includes(query);
  const groups: DiscoveryGroup[] = state.projects.map(project => ({
    id: project.projectId, name: project.name,
    sessions: order.map(id => source[id]).filter((item): item is SessionFact =>
      item?.projectId === project.projectId && matches(item, project.name)),
  })).filter(group => group.sessions.length > 0);
  const chats = order.map(id => source[id]).filter((item): item is SessionFact =>
    !!item && !item.projectId && matches(item, "Chats"));
  if (chats.length) groups.push({ id: "chats", name: "Chats", sessions: chats });
  return groups;
}

export const selectCurrentSession = (state: ClientState) => state.selectedSessionId
  ? state.sessions[state.selectedSessionId] ?? state.archivedSessions[state.selectedSessionId] : undefined;
export const selectCurrentTimeline = (state: ClientState) => state.selectedSessionId ? state.timelines[state.selectedSessionId] ?? [] : [];
export const selectDraft = (state: ClientState) => state.selectedSessionId ? state.drafts[state.selectedSessionId] ?? "" : "";
