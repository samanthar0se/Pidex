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

export interface NewSessionScope { projectId?: string; workspaceId?: string }
export type CommandResult =
  | { kind: "accepted" }
  | { kind: "rejected"; reason: string }
  | { kind: "uncertain"; reason: string };
export type SessionCreateResult = CommandResult & { session?: SessionFact };

export interface NewSessionState extends NewSessionScope {
  draft: string;
  status: "editing" | "creating" | "create-rejected" | "create-uncertain" |
    "session-created" | "submitting-run" | "run-rejected" | "run-uncertain" | "run-accepted";
  reason?: string;
  sessionId?: string;
}

export interface ClientAdapters {
  host: {
    readSession(sessionId: string): Promise<SessionProjection>;
    createSession?(command: { commandId: string } & NewSessionScope): Promise<SessionCreateResult>;
    submitRun?(command: { commandId: string; sessionId: string; prompt: string }): Promise<CommandResult>;
  };
  drafts: {
    read(sessionId: string): Promise<string>;
    write(sessionId: string, value: string): Promise<void>;
  };
  routing: { replace(path: string): void };
  commandIds?: () => string;
}

export interface ClientState {
  selectedSessionId?: string;
  sessions: Readonly<Record<string, SessionFact>>;
  timelines: Readonly<Record<string, readonly TimelineFact[]>>;
  drafts: Readonly<Record<string, string>>;
  isSessionCurrent: boolean;
  newSession?: NewSessionState;
  openSession(sessionId: string): Promise<void>;
  openNewSession(scope?: NewSessionScope): Promise<void>;
  setNewSessionScope(scope: NewSessionScope): Promise<void>;
  setNewSessionDraft(value: string): Promise<void>;
  submitNewSession(createEmpty?: boolean): Promise<void>;
  setDraft(value: string): Promise<void>;
}

export type ClientStore = StoreApi<ClientState>;

export function createClientStore(adapters: ClientAdapters): ClientStore {
  const commandId = adapters.commandIds ?? (() => crypto.randomUUID());
  return createStore<ClientState>((set, get) => ({
    sessions: {},
    timelines: {},
    drafts: {},
    isSessionCurrent: false,
    async openNewSession(scope = {}) {
      const draft = await adapters.drafts.read("new-session");
      set({ selectedSessionId: undefined, newSession: { ...scope, draft, status: "editing" } });
      adapters.routing.replace("/new");
    },
    async setNewSessionScope(scope) {
      const current = get().newSession;
      if (!current || current.status !== "editing") return;
      set({ newSession: { ...current, ...scope } });
    },
    async setNewSessionDraft(value) {
      const current = get().newSession;
      if (!current || current.status !== "editing") return;
      set({ newSession: { ...current, draft: value } });
      await adapters.drafts.write("new-session", value);
    },
    async submitNewSession(createEmpty = false) {
      const initial = get().newSession;
      if (!initial || initial.status !== "editing" || !adapters.host.createSession) return;
      const prompt = initial.draft;
      if (!createEmpty && !prompt.trim()) {
        set({ newSession: { ...initial, reason: "Enter a prompt or create an empty Session" } });
        return;
      }
      set({ newSession: { ...initial, status: "creating", reason: undefined } });
      const created = await adapters.host.createSession({
        commandId: commandId(), projectId: initial.projectId, workspaceId: initial.workspaceId,
      });
      if (created.kind !== "accepted" || !created.session) {
        const reason = created.kind === "accepted" ? "Host accepted creation without a Session projection" : created.reason;
        set({ newSession: { ...initial,
          status: created.kind === "uncertain" ? "create-uncertain" : "create-rejected",
          reason,
        } });
        return;
      }
      const durable = { ...initial, status: "session-created" as const, sessionId: created.session.sessionId };
      set(state => ({
        sessions: { ...state.sessions, [created.session!.sessionId]: created.session! },
        newSession: durable,
      }));
      if (createEmpty) {
        adapters.routing.replace(`/sessions/${encodeURIComponent(created.session.sessionId)}`);
        return;
      }
      if (!adapters.host.submitRun) return;
      set({ newSession: { ...durable, status: "submitting-run" } });
      const submitted = await adapters.host.submitRun({
        commandId: commandId(), sessionId: created.session.sessionId, prompt,
      });
      set({ newSession: { ...durable,
        status: submitted.kind === "accepted" ? "run-accepted" : submitted.kind === "uncertain" ? "run-uncertain" : "run-rejected",
        reason: submitted.kind === "accepted" ? undefined : submitted.reason,
      } });
      if (submitted.kind === "accepted") {
        adapters.routing.replace(`/sessions/${encodeURIComponent(created.session.sessionId)}`);
      }
    },
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
