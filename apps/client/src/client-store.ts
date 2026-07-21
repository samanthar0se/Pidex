import { createStore, type StoreApi } from "zustand/vanilla";

export interface SessionFact {
  sessionId: string;
  name: string;
  metadataRevision: number;
  timelineRevision: number;
}

export interface TimelineFact {
  entryId: string;
  kind: string;
  text: string;
  runId?: string | null;
  order?: number;
  revision?: number;
  finalized?: boolean;
  blobId?: string | null;
  toolCallId?: string | null;
}

export interface SessionProjection {
  session: SessionFact;
  timeline: TimelineFact[];
  olderCursor?: string | null;
}

export interface TimelineChange { baseRevision: number; revision: number; entry: TimelineFact }
export interface TimelinePage { entries: TimelineFact[]; olderCursor: string | null }

export interface ClientAdapters {
  host: {
    readSession(sessionId: string): Promise<SessionProjection>;
    watchSession?(sessionId: string, listener: (change: TimelineChange) => void): () => void;
    readOlder?(sessionId: string, cursor: string): Promise<TimelinePage>;
    markRead?(sessionId: string, timelineRevision: number): Promise<void>;
  };
  drafts: {
    read(sessionId: string): Promise<string>;
    write(sessionId: string, value: string): Promise<void>;
  };
  routing: { replace(path: string): void };
}

export interface ClientState {
  selectedSessionId?: string;
  sessions: Readonly<Record<string, SessionFact>>;
  timelines: Readonly<Record<string, readonly TimelineFact[]>>;
  olderCursors: Readonly<Record<string, string | null>>;
  paging: "idle" | "loading" | "error";
  drafts: Readonly<Record<string, string>>;
  isSessionCurrent: boolean;
  openSession(sessionId: string): Promise<void>;
  setDraft(value: string): Promise<void>;
  loadOlder(): Promise<void>;
  presentTail(): Promise<void>;
}

export type ClientStore = StoreApi<ClientState>;

export function createClientStore(adapters: ClientAdapters): ClientStore {
  return createStore<ClientState>((set, get) => ({
    sessions: {},
    timelines: {},
    olderCursors: {},
    paging: "idle",
    drafts: {},
    isSessionCurrent: false,
    async openSession(sessionId) {
      set({ selectedSessionId: sessionId, isSessionCurrent: false });
      adapters.routing.replace(`/sessions/${encodeURIComponent(sessionId)}`);
      const [projection, draft] = await Promise.all([
        adapters.host.readSession(sessionId),
        adapters.drafts.read(sessionId),
      ]);
      if (get().selectedSessionId !== sessionId) return;
      set(state => ({
        sessions: { ...state.sessions, [sessionId]: projection.session },
        timelines: { ...state.timelines, [sessionId]: projection.timeline },
        olderCursors: { ...state.olderCursors, [sessionId]: projection.olderCursor ?? null },
        drafts: { ...state.drafts, [sessionId]: draft },
        isSessionCurrent: true,
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
          entries.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
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
        set({ paging: "error" });
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
  return [...entries.values()].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

export const selectCurrentSession = (state: ClientState) =>
  state.selectedSessionId ? state.sessions[state.selectedSessionId] : undefined;

export const selectCurrentTimeline = (state: ClientState) =>
  state.selectedSessionId ? state.timelines[state.selectedSessionId] ?? [] : [];

export const selectDraft = (state: ClientState) =>
  state.selectedSessionId ? state.drafts[state.selectedSessionId] ?? "" : "";
