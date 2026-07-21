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
export interface TimelineFact { entryId: string; kind: string; text: string; }
export interface SessionProjection { session: SessionFact; timeline: TimelineFact[]; }
export interface DiscoveryProjection {
  projects: ProjectFact[];
  sessions: SessionFact[];
  archivedSessions: SessionFact[];
}
export interface DiscoveryGroup { id: string; name: string; sessions: SessionFact[]; }

export interface ClientAdapters {
  host: {
    readCatalog?(): Promise<DiscoveryProjection>;
    readSession(sessionId: string): Promise<SessionProjection>;
    restoreSession?(session: SessionFact): Promise<void>;
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
}

export interface ClientState {
  selectedSessionId?: string;
  projects: readonly ProjectFact[];
  sessions: Readonly<Record<string, SessionFact>>;
  sessionOrder: readonly string[];
  archivedSessions: Readonly<Record<string, SessionFact>>;
  archivedOrder: readonly string[];
  timelines: Readonly<Record<string, readonly TimelineFact[]>>;
  drafts: Readonly<Record<string, string>>;
  expandedProjectIds: readonly string[];
  searchQuery: string;
  discoveryMode: "available" | "archived";
  isSessionCurrent: boolean;
  loadDiscovery(): Promise<void>;
  openSession(sessionId: string, history?: "push" | "replace" | "none"): Promise<void>;
  setDraft(value: string): Promise<void>;
  setSearchQuery(query: string): void;
  setDiscoveryMode(mode: "available" | "archived"): void;
  toggleProject(projectId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
}

export type ClientStore = StoreApi<ClientState>;

export function createClientStore(adapters: ClientAdapters): ClientStore {
  return createStore<ClientState>((set, get) => ({
    projects: [], sessions: {}, sessionOrder: [], archivedSessions: {}, archivedOrder: [],
    timelines: {}, drafts: {}, expandedProjectIds: [], searchQuery: "", discoveryMode: "available",
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
    async openSession(sessionId, navigation = "replace") {
      set({ selectedSessionId: sessionId, isSessionCurrent: false });
      const path = `/sessions/${encodeURIComponent(sessionId)}`;
      if (navigation === "push") (adapters.routing.push ?? adapters.routing.replace)(path);
      else if (navigation === "replace") adapters.routing.replace(path);
      const [projection, draft] = await Promise.all([adapters.host.readSession(sessionId), adapters.drafts.read(sessionId)]);
      if (get().selectedSessionId !== sessionId) return;
      set(state => ({
        sessions: { ...state.sessions, [sessionId]: projection.session },
        timelines: { ...state.timelines, [sessionId]: projection.timeline },
        drafts: { ...state.drafts, [sessionId]: draft }, isSessionCurrent: true,
      }));
    },
    async setDraft(value) {
      const sessionId = get().selectedSessionId;
      if (!sessionId) return;
      set(state => ({ drafts: { ...state.drafts, [sessionId]: value } }));
      await adapters.drafts.write(sessionId, value);
    },
    setSearchQuery(searchQuery) { set({ searchQuery }); },
    setDiscoveryMode(discoveryMode) {
      set({ discoveryMode });
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
  }));
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
