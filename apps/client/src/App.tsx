import { useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Menu, Plus, Search, X } from "lucide-react";
import { useStore } from "zustand";
import { store } from "./main.js";
import {
  selectCurrentSession,
  selectCurrentTimeline,
  selectDiscoveryGroups,
  selectDraft,
  type NewSessionProgress,
  type NewSessionState,
  type SessionFact,
} from "./client-store.js";
import { SessionTimeline } from "./SessionTimeline.js";

function applyPath(path: string) {
  if (path === "/new") {
    void store.getState().openNewSession();
    return;
  }
  if (path === "/archived") store.setState({ discoveryMode: "archived" });
  const match = path.match(/^\/sessions\/([^/]+)$/);
  if (match) void store.getState().openSession(decodeURIComponent(match[1]), "none");
}

function describeSessionCues(session: SessionFact) {
  const unread = session.readState?.readStatus === "unread";
  let attention: string | undefined;
  if (session.attention === "working") attention = "Working";
  if (session.attention === "needs-response") attention = "Needs response";

  const labels = [unread ? "Unread" : undefined, attention].filter((label): label is string => Boolean(label));
  return { unread, attention, accessibleName: [session.name, ...labels].join(", ") };
}

export function App() {
  const session = useStore(store, selectCurrentSession);
  const timeline = useStore(store, selectCurrentTimeline);
  const draft = useStore(store, selectDraft);
  const groups = useStore(store, selectDiscoveryGroups);
  const state = useStore(store);
  const newSession = state.newSession;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void store.getState().loadDiscovery();
    applyPath(location.pathname);
  }, []);
  useEffect(() => {
    const listener = () => applyPath(location.pathname);
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  }, []);
  const closeDrawer = () => { setDrawerOpen(false); requestAnimationFrame(() => drawerToggle.current?.focus()); };
  const choose = (id: string) => { void store.getState().openSession(id, "push"); closeDrawer(); };
  const searching = state.searchQuery.trim() !== "";

  return <div className={`shell ${drawerOpen ? "drawer-open" : ""}`}>
    <button className="drawer-backdrop" aria-label="Close Session drawer" onClick={closeDrawer}/>
    <aside aria-label="Session drawer" onKeyDown={event => { if (event.key === "Escape") closeDrawer(); }}>
      <div className="brand"><strong>PIDEX</strong><button className="close-drawer" aria-label="Close Session drawer" onClick={closeDrawer}><X/></button></div>
      <button className="new-session-button" onClick={() => { void store.getState().openNewSession(); closeDrawer(); }}><Plus size={16}/> New Session</button>
      <label className="search"><Search size={15}/><input aria-label="Search Sessions" placeholder="Search Sessions" value={state.searchQuery} onChange={event => store.getState().setSearchQuery(event.target.value)}/></label>
      <nav aria-label={state.discoveryMode === "archived" ? "Archived Sessions" : "Sessions"}>
        {groups.map(group => {
          const expanded = searching || group.id === "chats" || state.expandedProjectIds.includes(group.id);
          return <section className="discovery-group" key={group.id}>
            <button className="group-heading" aria-expanded={expanded} onClick={() => group.id !== "chats" && void store.getState().toggleProject(group.id)}>
              {group.id !== "chats" && (expanded ? <ChevronDown/> : <ChevronRight/>)}<span>{group.name}</span>
            </button>
            {expanded && group.sessions.map(item => {
              const cues = describeSessionCues(item);
              return <div className="session-row" key={item.sessionId}>
                <button className="session-link" aria-current={state.selectedSessionId === item.sessionId ? "page" : undefined}
                  aria-label={cues.accessibleName} onClick={() => choose(item.sessionId)}>
                  <span className="session-name">{item.name}</span><span className="cues" aria-hidden="true">{cues.unread && <i className="unread"/>}{cues.attention}</span>
                </button>
                {state.discoveryMode === "archived" && <button className="restore" onClick={() => void store.getState().restoreSession(item.sessionId)}>Restore</button>}
              </div>;
            })}
          </section>;
        })}
        {groups.length === 0 && <p className="no-results">No matching Sessions</p>}
      </nav>
      <button className="archived" aria-pressed={state.discoveryMode === "archived"} onClick={() => store.getState().setDiscoveryMode(state.discoveryMode === "archived" ? "available" : "archived")}><Archive size={16}/>{state.discoveryMode === "archived" ? "Back to Sessions" : "Archived"}</button>
    </aside>
    <main>
      <header><button ref={drawerToggle} className="menu" aria-label="Open Session drawer" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu/></button><div><h1>{newSession ? "New Session" : session?.name ?? (state.discoveryMode === "archived" ? "Archived Sessions" : "Pidex")}</h1><small>{newSession ? "Nothing is created until you submit" : session && (state.isSessionCurrent ? "Current" : "Reconciling current Host data")}</small></div></header>
      {newSession && <NewSessionView newSession={newSession}/>}
      {!newSession && <>
        {session ? <SessionTimeline entries={timeline} olderCursor={state.olderCursors[session.sessionId]} paging={state.paging}
          loadOlder={() => store.getState().loadOlder()} presentTail={() => store.getState().presentTail()}/>
          : <section className="timeline" aria-label="Session Timeline"><div className="empty"><h2>Choose a Session</h2><p>Resume a Chat or open a Project.</p></div></section>}
        {session && <Composer sessionId={session.sessionId} draft={draft}/>}
      </>}
    </main>
  </div>;
}

function Composer({ sessionId, draft }: { sessionId: string; draft: string }) {
  const state = useStore(store);
  const runs = state.runs[sessionId] ?? [];
  const executing = runs.find(run => run.state === "executing" && run.workerGeneration);
  const held = runs.filter(run => run.state === "held");
  const interactions = state.interactions[sessionId] ?? [];
  const [interactionIndex, setInteractionIndex] = useState<number | null>(null);
  const [response, setResponse] = useState<string | boolean>("");
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!interactions.length) { setInteractionIndex(null); return; }
    if (interactionIndex !== null && interactionIndex < interactions.length) return;
    if (!draft && document.activeElement !== composer.current) setInteractionIndex(0);
  }, [interactions, interactionIndex, draft]);
  const interaction = interactionIndex === null ? undefined : interactions[interactionIndex];
  const action = executing ? (draft.trim() ? "Send" : "Stop") : "Run";
  const submit = () => void store.getState().submitComposer();
  return <footer className="composer-dock">
    {interactions.length > 0 && !interaction && <button className="interaction-cue" onClick={() => setInteractionIndex(0)}>
      {interactions.length} open Interaction{interactions.length === 1 ? "" : "s"}
    </button>}
    {held.length > 0 && <section className="held-work" aria-label="Recovery-held follow-ups">
      {held.map(run => <div key={run.runId}><span>{run.prompt}</span>
        <button onClick={() => void store.getState().actOnHeldRun(run.runId, "release")}>Release</button>
        <button onClick={() => void store.getState().actOnHeldRun(run.runId, "cancel")}>Cancel</button>
      </div>)}
    </section>}
    {!interaction && <div className="next-run-controls" aria-label="Next Run configuration">
      <select disabled aria-label="Model for next Run"><option>Host default model</option></select>
      <select disabled aria-label="Mode for next Run"><option>Host default mode</option></select>
    </div>}
    {interaction ? <section className="interaction-control" aria-label="Open Interactions">
      <div className="interaction-heading"><strong>Interaction {interactionIndex! + 1} of {interactions.length}</strong>
        <span>{interaction.runId ? `Run ${interaction.runId}` : "Session request"}{interaction.provenance ? ` · ${interaction.provenance}` : ""}</span></div>
      <p>{interaction.payload.message}</p>
      {interaction.kind === "select" && <select aria-label="Interaction response" value={String(response)} onChange={event => setResponse(event.target.value)}>
        <option value="">Choose…</option>{interaction.payload.options?.map(option => <option key={option}>{option}</option>)}</select>}
      {interaction.kind === "confirm" && <select aria-label="Interaction response" value={String(response)} onChange={event => setResponse(event.target.value === "true")}><option value="">Choose…</option><option value="true">Confirm</option><option value="false">Decline</option></select>}
      {interaction.kind === "input" && <input aria-label="Interaction response" value={String(response)} onChange={event => setResponse(event.target.value)}/>}
      {interaction.kind === "editor" && <textarea aria-label="Interaction response" value={String(response)} onChange={event => setResponse(event.target.value)}/>}
      <div className="interaction-actions">
        <button onClick={() => { setInteractionIndex(null); requestAnimationFrame(() => composer.current?.focus()); }}>Write message</button>
        <button disabled={interactions.length < 2} onClick={() => { setInteractionIndex((interactionIndex! + 1) % interactions.length); setResponse(""); }}>Next request</button>
        <button disabled={Boolean(state.interactionIntents[interaction.interactionId])} onClick={() => void store.getState().resolveInteraction(interaction.interactionId, true)}>Dismiss</button>
        <button disabled={Boolean(state.interactionIntents[interaction.interactionId]) || response === ""} onClick={() => void store.getState().resolveInteraction(interaction.interactionId, false, response)}>Respond</button>
        {executing && <button aria-label={`Stop Run ${executing.runId}`} onClick={() => void store.getState().stopRun(executing.runId)}>Stop</button>}
      </div>
      {state.interactionIntents[interaction.interactionId] && <p role="status">{state.interactionIntents[interaction.interactionId]!.phase}</p>}
    </section> : <div className="composer-row">
      <textarea ref={composer} aria-label="Composer" value={draft} onChange={event => void store.getState().setDraft(event.target.value)} placeholder="Ask Pi…"
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/>
      <button aria-label={executing && !draft.trim() ? `Stop Run ${executing.runId}` : action} onClick={submit}>{action}</button>
    </div>}
    {state.commandOutcomes.map(outcome => <p key={outcome.commandId} className={`command-outcome ${outcome.phase}`} role="status">
      {outcome.action} · {outcome.phase}{outcome.reason ? `: ${outcome.reason}` : ""}
    </p>)}
  </footer>;
}

function describeProgress(progress: NewSessionProgress) {
  switch (progress.phase) {
    case "editing":
      return { reason: progress.reason };
    case "creating":
    case "submitting-run":
      return {};
    case "creation-failed":
      return { reason: progress.result.reason, uncertain: progress.result.kind === "uncertain" };
    case "session-created":
      return { sessionCreated: "Session created." };
    case "run-finished":
      switch (progress.result.kind) {
        case "accepted":
          return { sessionCreated: "Session created; initial Run accepted." };
        case "rejected":
          return { reason: progress.result.reason, sessionCreated: "Session created; initial Run rejected." };
        case "uncertain":
          return {
            reason: progress.result.reason,
            uncertain: true,
            sessionCreated: "Session created; initial Run acceptance is uncertain.",
          };
      }
  }
}

function NewSessionView({ newSession }: { newSession: NewSessionState }) {
  const editable = newSession.progress.phase === "editing";
  const description = describeProgress(newSession.progress);
  const submit = () => void store.getState().submitNewSession();
  return <section className="new-session" aria-label="New Session">
    <div className="scope-controls">
      <label>Project <input disabled={!editable} value={newSession.projectId ?? ""} onChange={event => void store.getState().setNewSessionScope({ projectId: event.target.value || undefined, workspaceId: undefined })}/></label>
      <label>Workspace <input disabled={!editable} value={newSession.workspaceId ?? ""} onChange={event => void store.getState().setNewSessionScope({ projectId: newSession.projectId, workspaceId: event.target.value || undefined })}/></label>
      {(["Runtime", "Model", "Mode"] as const).map(choice => <label key={choice}>{choice}<select disabled title={`${choice} choices were not advertised by the Host`}><option>Host default — no choices advertised</option></select></label>)}
    </div>
    <label className="new-composer">First prompt
      <textarea autoFocus aria-label="First prompt" value={newSession.draft} disabled={!editable}
        onChange={event => void store.getState().setNewSessionDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/>
    </label>
    {description.reason && <p className="creation-outcome" role="alert">{description.uncertain ? "Outcome uncertain; do not retry. " : ""}{description.reason}</p>}
    {description.sessionCreated && <p>{description.sessionCreated}</p>}
    <div className="new-actions"><button disabled={!editable} onClick={() => void store.getState().submitNewSession(true)}>Create empty Session</button><button disabled={!editable} onClick={submit}>Create &amp; Run</button></div>
  </section>;
}
