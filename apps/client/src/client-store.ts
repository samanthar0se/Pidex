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
}

export interface SessionProjection {
  session: SessionFact;
  timeline: TimelineFact[];
}

export interface ClientAdapters {
  host: { readSession(sessionId: string): Promise<SessionProjection> };
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
  drafts: Readonly<Record<string, string>>;
  isSessionCurrent: boolean;
  openSession(sessionId: string): Promise<void>;
  setDraft(value: string): Promise<void>;
}

export type ClientStore = StoreApi<ClientState>;

export function createClientStore(adapters: ClientAdapters): ClientStore {
  return createStore<ClientState>((set, get) => ({
    sessions: {},
    timelines: {},
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
        drafts: { ...state.drafts, [sessionId]: draft },
        isSessionCurrent: true,
      }));
    },
    async setDraft(value) {
      const sessionId = get().selectedSessionId;
      if (!sessionId) return;
      set(state => ({ drafts: { ...state.drafts, [sessionId]: value } }));
      await adapters.drafts.write(sessionId, value);
    },
  }));
}

export const selectCurrentSession = (state: ClientState) =>
  state.selectedSessionId ? state.sessions[state.selectedSessionId] : undefined;

export const selectCurrentTimeline = (state: ClientState) =>
  state.selectedSessionId ? state.timelines[state.selectedSessionId] ?? [] : [];

export const selectDraft = (state: ClientState) =>
  state.selectedSessionId ? state.drafts[state.selectedSessionId] ?? "" : "";
