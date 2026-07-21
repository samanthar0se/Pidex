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
export type RunState = "queued" | "executing" | "cancelling" | "held" | "completed" | "failed" | "cancelled" | "interrupted";
export interface RunFact {
  runId: string; sessionId: string; sessionOrder: number; prompt: string; state: RunState; workerGeneration?: string;
}
export type InteractionState = "open" | "resolving" | "responded" | "dismissed" | "expired" | "withdrawn";
export interface InteractionFact {
  interactionId: string; sessionId: string; runId: string | null; workerGeneration: number;
  correlationId: string; kind: "select" | "confirm" | "input" | "editor";
  payload: { message: string; options?: string[]; defaultValue?: string | boolean };
  provenance?: string; state: InteractionState; revision: number; createdAt: number; deadlineAt: number | null;
  terminalCause: string | null; respondedAt: number | null; respondingDeviceLabel: string | null; applicationProven: boolean | null;
}
export type InteractionResolution =
  | { kind: "dismiss" }
  | { kind: "respond"; value: string | boolean };
export interface SessionProjection { session: SessionFact; timeline: TimelineFact[]; runs?: RunFact[]; interactions?: InteractionFact[]; olderCursor?: string | null; }
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
export type ReconciledCommandResult =
  | { kind: "accepted" }
  | { kind: "rejected"; reason: string }
  | { kind: "expired"; reason: string }
  | { kind: "indeterminate"; reason: string };
export type AuthorityStatus = "current" | "offline" | "reconnecting" | "update-required" | "revoked";
export interface AuthorityState { status: AuthorityStatus; lastSynchronizedAt: string | null; reason?: string }
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

type ComposerRunAction = "steer" | "stop" | "release" | "cancel";
type ComposerCommandTarget =
  | { action: "submit" }
  | { action: ComposerRunAction; runId: string };
type ComposerCommand = ComposerCommandTarget & {
  commandId: string;
  phase: "pending" | "accepted-awaiting-projection" | "rejected" | "uncertain";
  reason?: string;
};

export interface ClientAdapters {
  host: {
    readCatalog?(): Promise<DiscoveryProjection>;
    readSession(sessionId: string): Promise<SessionProjection>;
    restoreSession?(session: SessionFact): Promise<void>;
    createSession?(command: { commandId: string } & NewSessionScope): Promise<SessionCreateResult>;
    submitRun?(command: { commandId: string; sessionId: string; prompt: string }): Promise<CommandResult>;
    steerRun?(command: { commandId: string; sessionId: string; runId: string; workerGeneration: string; observedTimelineRevision: number; text: string }): Promise<CommandResult>;
    stopRun?(command: { commandId: string; sessionId: string; runId: string; workerGeneration: string; observedState: "executing"; observedTimelineRevision: number }): Promise<CommandResult>;
    actOnHeldRun?(command: { commandId: string; runId: string; action: "release" | "cancel" }): Promise<CommandResult>;
    resolveInteraction?(command: { type: "interaction.resolve"; commandId: string; interactionId: string; workerGeneration: number; observedRevision: number; dismiss: boolean; value?: string | boolean }): Promise<CommandResult>;
    watchSession?(sessionId: string, listener: (change: TimelineChange) => void): () => void;
    watchRuns?(sessionId: string, listener: (runs: RunFact[]) => void): () => void;
    watchInteractions?(sessionId: string, listener: (interactions: InteractionFact[]) => void): () => void;
    readOlder?(sessionId: string, cursor: string): Promise<TimelinePage>;
    markRead?(sessionId: string, timelineRevision: number): Promise<void>;
    reconcileCommand?(commandId: string): Promise<ReconciledCommandResult>;
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
  runs: Readonly<Record<string, readonly RunFact[]>>;
  interactions: Readonly<Record<string, readonly InteractionFact[]>>;
  interactionIntents: Readonly<Record<string, { commandId: string; phase: ComposerCommand["phase"]; reason?: string }>>;
  olderCursors: Readonly<Record<string, string | null>>;
  paging: "idle" | "loading" | "error";
  drafts: Readonly<Record<string, string>>;
  expandedProjectIds: readonly string[];
  searchQuery: string;
  discoveryMode: "available" | "archived";
  isSessionCurrent: boolean;
  authority: AuthorityState;
  newSession?: NewSessionState;
  loadDiscovery(): Promise<void>;
  openSession(sessionId: string, history?: "push" | "replace" | "none"): Promise<void>;
  openNewSession(scope?: NewSessionScope): Promise<void>;
  setNewSessionScope(scope: NewSessionScope): Promise<void>;
  setNewSessionDraft(value: string): Promise<void>;
  submitNewSession(createEmpty?: boolean): Promise<void>;
  setDraft(value: string): Promise<void>;
  composerCommand?: ComposerCommand;
  commandOutcomes: readonly ComposerCommand[];
  submitComposer(): Promise<void>;
  stopRun(runId: string): Promise<void>;
  actOnHeldRun(runId: string, action: "release" | "cancel"): Promise<void>;
  resolveInteraction(interactionId: string, resolution: InteractionResolution): Promise<void>;
  setSearchQuery(query: string): void;
  setDiscoveryMode(mode: "available" | "archived"): void;
  toggleProject(projectId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  loadOlder(): Promise<void>;
  presentTail(): Promise<void>;
  authorityChanged(authority: Omit<AuthorityState, "lastSynchronizedAt"> & { lastSynchronizedAt?: string | null }): void;
  recoverAuthority(): Promise<void>;
}

export type ClientStore = StoreApi<ClientState>;

export function createClientStore(adapters: ClientAdapters): ClientStore {
  const commandId = adapters.commandIds ?? (() => crypto.randomUUID());
  return createStore<ClientState>((set, get) => ({
    projects: [], sessions: {}, sessionOrder: [], archivedSessions: {}, archivedOrder: [],
    timelines: {}, runs: {}, interactions: {}, interactionIntents: {}, commandOutcomes: [], olderCursors: {}, paging: "idle", drafts: {}, expandedProjectIds: [], searchQuery: "", discoveryMode: "available",
    isSessionCurrent: false,
    authority: { status: "current", lastSynchronizedAt: null },
    async loadDiscovery() {
      if (!adapters.host.readCatalog) return;
      try {
        const [catalog, expanded] = await Promise.all([
          adapters.host.readCatalog(),
          adapters.preferences?.readExpandedProjects() ?? Promise.resolve([]),
        ]);
        set({
          ...discoveryStateFrom(catalog),
          expandedProjectIds: expanded,
        });
      } catch (error) {
        set(state => ({ authority: offlineAuthority(state.authority, error) }));
      }
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
      if (!initial || initial.progress.phase !== "editing" || get().authority.status !== "current" || !adapters.host.createSession) return;
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
      let projection: SessionProjection;
      let draft: string;
      try {
        [projection, draft] = await Promise.all([adapters.host.readSession(sessionId), adapters.drafts.read(sessionId)]);
      } catch (error) {
        const localDraft = await adapters.drafts.read(sessionId).catch(() => get().drafts[sessionId] ?? "");
        if (get().selectedSessionId === sessionId) set(state => ({
          drafts: { ...state.drafts, [sessionId]: localDraft },
          authority: offlineAuthority(state.authority, error),
          isSessionCurrent: false,
        }));
        return;
      }
      if (get().selectedSessionId !== sessionId) return;
      set(state => ({
        sessions: { ...state.sessions, [sessionId]: projection.session },
        timelines: { ...state.timelines, [sessionId]: projection.timeline },
        runs: { ...state.runs, [sessionId]: projection.runs ?? [] },
        interactions: { ...state.interactions, [sessionId]: activeInteractions(projection.interactions ?? []) },
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
      adapters.host.watchRuns?.(sessionId, runs => {
        if (get().selectedSessionId === sessionId) set(state => ({ runs: { ...state.runs, [sessionId]: runs } }));
      });
      adapters.host.watchInteractions?.(sessionId, interactions => {
        if (get().selectedSessionId !== sessionId) return;
        const active = activeInteractions(interactions);
        const activeIds = new Set(active.map(item => item.interactionId));
        set(state => ({
          interactions: { ...state.interactions, [sessionId]: active },
          interactionIntents: Object.fromEntries(Object.entries(state.interactionIntents).filter(([id]) => activeIds.has(id))),
        }));
      });
    },
    async setDraft(value) {
      const sessionId = get().selectedSessionId;
      if (!sessionId) return;
      set(state => ({ drafts: { ...state.drafts, [sessionId]: value } }));
      await adapters.drafts.write(sessionId, value);
    },
    async submitComposer() {
      const state = get();
      const sessionId = state.selectedSessionId;
      const session = sessionId ? state.sessions[sessionId] : undefined;
      if (!sessionId || !session || !state.isSessionCurrent) return;
      const executing = state.runs[sessionId]?.find(run => run.state === "executing" && run.workerGeneration);
      const text = state.drafts[sessionId] ?? "";
      const id = commandId();
      let target: ComposerCommandTarget;
      let result: CommandResult;
      if (executing && text.trim() && adapters.host.steerRun) {
        target = { action: "steer", runId: executing.runId };
        set({ composerCommand: pendingCommand(id, target) });
        result = await adapters.host.steerRun({ commandId: id, sessionId, runId: executing.runId, workerGeneration: executing.workerGeneration!, observedTimelineRevision: session.timelineRevision, text });
      } else if (executing && !text.trim() && adapters.host.stopRun) {
        target = { action: "stop", runId: executing.runId };
        set({ composerCommand: pendingCommand(id, target) });
        result = await adapters.host.stopRun({ commandId: id, sessionId, runId: executing.runId, workerGeneration: executing.workerGeneration!, observedState: "executing", observedTimelineRevision: session.timelineRevision });
      } else if (text.trim() && adapters.host.submitRun) {
        target = { action: "submit" };
        set({ composerCommand: pendingCommand(id, target) });
        result = await adapters.host.submitRun({ commandId: id, sessionId, prompt: text });
      } else return;
      const outcome = commandState(id, target, result);
      set(current => ({ composerCommand: outcome, commandOutcomes: [...current.commandOutcomes, outcome] }));
      if (result.kind === "accepted" && text) await get().setDraft("");
    },
    async stopRun(runId) {
      const state = get();
      const sessionId = state.selectedSessionId;
      const session = sessionId ? state.sessions[sessionId] : undefined;
      const run = sessionId ? state.runs[sessionId]?.find(item => item.runId === runId) : undefined;
      if (!sessionId || !session || run?.state !== "executing" || !run.workerGeneration || !state.isSessionCurrent || !adapters.host.stopRun) return;
      const id = commandId();
      const target = { action: "stop" as const, runId };
      set({ composerCommand: pendingCommand(id, target) });
      const result = await adapters.host.stopRun({ commandId: id, sessionId, runId, workerGeneration: run.workerGeneration, observedState: "executing", observedTimelineRevision: session.timelineRevision });
      const outcome = commandState(id, target, result);
      set(current => ({ composerCommand: outcome, commandOutcomes: [...current.commandOutcomes, outcome] }));
    },
    async actOnHeldRun(runId, action) {
      const state = get();
      const sessionId = state.selectedSessionId;
      const run = sessionId ? state.runs[sessionId]?.find(item => item.runId === runId) : undefined;
      if (!sessionId || run?.state !== "held" || !state.isSessionCurrent || state.authority.status !== "current" || !adapters.host.actOnHeldRun) return;
      const id = commandId();
      const target = { action, runId };
      set({ composerCommand: pendingCommand(id, target) });
      const result = await adapters.host.actOnHeldRun({ commandId: id, runId, action });
      const outcome = commandState(id, target, result);
      set(current => ({
        composerCommand: outcome,
        commandOutcomes: [...current.commandOutcomes, outcome],
        runs: result.kind === "accepted" ? { ...current.runs, [sessionId]: current.runs[sessionId]!.map(item => item.runId === runId ? { ...item, state: action === "release" ? "executing" : "cancelled" } : item) } : current.runs,
      }));
    },
    async resolveInteraction(interactionId, resolution) {
      const state = get();
      const sessionId = state.selectedSessionId;
      const interaction = sessionId ? state.interactions[sessionId]?.find(item => item.interactionId === interactionId) : undefined;
      if (!interaction || interaction.state !== "open" || !adapters.host.resolveInteraction || !state.isSessionCurrent) return;
      const id = commandId();
      set(current => ({ interactionIntents: { ...current.interactionIntents, [interactionId]: { commandId: id, phase: "pending" } } }));
      const result = await adapters.host.resolveInteraction({
        type: "interaction.resolve", commandId: id, interactionId,
        workerGeneration: interaction.workerGeneration, observedRevision: interaction.revision,
        dismiss: resolution.kind === "dismiss",
        ...(resolution.kind === "respond" ? { value: resolution.value } : {}),
      });
      set(current => ({ interactionIntents: { ...current.interactionIntents, [interactionId]: {
        commandId: id, phase: result.kind === "accepted" ? "accepted-awaiting-projection" : result.kind,
        ...(result.kind === "accepted" ? {} : { reason: result.reason }),
      } } }));
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
      if (!session || get().authority.status !== "current" || !adapters.host.restoreSession) return;
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
    authorityChanged(authority) {
      const previous = get().authority;
      set({
        authority: {
          ...authority,
          lastSynchronizedAt: authority.lastSynchronizedAt === undefined
            ? previous.lastSynchronizedAt : authority.lastSynchronizedAt,
        },
        isSessionCurrent: authority.status === "current" && get().isSessionCurrent,
      });
    },
    async recoverAuthority() {
      const before = get().authority;
      if (before.status === "update-required" || before.status === "revoked") return;
      set({ authority: { ...before, status: "reconnecting" }, isSessionCurrent: false });
      try {
        const catalog = adapters.host.readCatalog ? await adapters.host.readCatalog() : undefined;
        const sessionId = get().selectedSessionId;
        const projection = sessionId ? await adapters.host.readSession(sessionId) : undefined;
        const uncertain = get().commandOutcomes.filter(command => command.phase === "uncertain");
        const uncertainInteractions = Object.entries(get().interactionIntents)
          .filter(([, intent]) => intent.phase === "uncertain");
        const reconciled = new Map<string, ReconciledCommandResult>();
        if ((uncertain.length || uncertainInteractions.length) && !adapters.host.reconcileCommand) {
          throw new Error("Original uncertain commands cannot be reconciled");
        }
        for (const command of uncertain) reconciled.set(command.commandId, await adapters.host.reconcileCommand!(command.commandId));
        for (const [, intent] of uncertainInteractions) reconciled.set(intent.commandId, await adapters.host.reconcileCommand!(intent.commandId));
        const synchronizedAt = new Date().toISOString();
        set(state => ({
          ...(catalog ? discoveryStateFrom(catalog) : {}),
          ...(sessionId && projection ? {
            sessions: { ...(catalog ? byId(catalog.sessions) : state.sessions), [sessionId]: projection.session },
            timelines: { ...state.timelines, [sessionId]: projection.timeline },
            runs: { ...state.runs, [sessionId]: projection.runs ?? [] },
            interactions: { ...state.interactions, [sessionId]: activeInteractions(projection.interactions ?? []) },
            olderCursors: { ...state.olderCursors, [sessionId]: projection.olderCursor ?? null },
          } : {}),
          commandOutcomes: state.commandOutcomes.map(command => {
            const result = reconciled.get(command.commandId);
            if (!result) return command;
            if (result.kind === "accepted") return { ...command, phase: "accepted-awaiting-projection" as const, reason: undefined };
            return { ...command, phase: "rejected" as const, reason: `${result.kind}: ${result.reason}` };
          }),
          interactionIntents: Object.fromEntries(Object.entries(state.interactionIntents).map(([id, intent]) => {
            const result = reconciled.get(intent.commandId);
            if (!result) return [id, intent];
            return [id, result.kind === "accepted"
              ? { ...intent, phase: "accepted-awaiting-projection" as const, reason: undefined }
              : { ...intent, phase: "rejected" as const, reason: `${result.kind}: ${result.reason}` }];
          })),
          authority: { status: "current", lastSynchronizedAt: synchronizedAt },
          isSessionCurrent: !sessionId || Boolean(projection),
        }));
      } catch (error) {
        set({
          authority: offlineAuthority(before, error),
          isSessionCurrent: false,
        });
      }
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

function activeInteractions(interactions: readonly InteractionFact[]): InteractionFact[] {
  return interactions.filter(item => item.state === "open" || item.state === "resolving");
}

function discoveryStateFrom(catalog: DiscoveryProjection) {
  return {
    projects: catalog.projects,
    sessions: byId(catalog.sessions),
    sessionOrder: catalog.sessions.map(item => item.sessionId),
    archivedSessions: byId(catalog.archivedSessions),
    archivedOrder: catalog.archivedSessions.map(item => item.sessionId),
  };
}

function offlineAuthority(authority: AuthorityState, error: unknown): AuthorityState {
  return {
    ...authority,
    status: "offline",
    reason: error instanceof Error ? error.message : "Host unavailable",
  };
}

function byId(items: SessionFact[]) { return Object.fromEntries(items.map(item => [item.sessionId, item])); }
function omit(items: Readonly<Record<string, SessionFact>>, id: string) {
  const next = { ...items }; delete next[id]; return next;
}

function pendingCommand(commandId: string, target: ComposerCommandTarget): ComposerCommand {
  return { commandId, ...target, phase: "pending" };
}

function commandState(
  commandId: string,
  target: ComposerCommandTarget,
  result: CommandResult,
): ComposerCommand {
  if (result.kind === "accepted") return { commandId, ...target, phase: "accepted-awaiting-projection" };
  return { commandId, ...target, phase: result.kind, reason: result.reason };
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
