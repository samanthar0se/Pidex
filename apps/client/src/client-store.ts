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
      const durable = {
        ...initial,
        progress: { phase: "session-created" as const, sessionId },
      };
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
      const submitted = await adapters.host.submitRun({
        commandId: commandId(), sessionId, prompt,
      });
      set({ newSession: { ...durable, progress: {
        phase: "run-finished", sessionId, result: submitted,
      } } });
      if (submitted.kind === "accepted") {
        adapters.routing.replace(`/sessions/${encodeURIComponent(sessionId)}`);
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
