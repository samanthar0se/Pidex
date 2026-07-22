import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { store as productionStore } from "./client-instance.js";
import type { ClientStore } from "./client-store.js";
import {
  selectCurrentSession,
  selectCurrentTimeline,
  selectDraft,
  type NewSessionProgress,
  type NewSessionState,
} from "./client-store.js";
import { useClientLifecycle } from "./client-lifecycle.js";
import { ClientHeader } from "./ClientHeader.js";
import { InteractionControl } from "./InteractionControl.js";
import { SessionDrawer, useSessionDrawer } from "./SessionDrawer.js";
import { SessionTimeline } from "./SessionTimeline.js";

export function App({ clientStore = productionStore }: { clientStore?: ClientStore } = {}) {
  const store = clientStore;
  const state = useStore(store);
  const session = selectCurrentSession(state);
  const timeline = selectCurrentTimeline(state);
  const draft = selectDraft(state);
  const newSession = state.newSession;
  const drawer = useSessionDrawer();
  useClientLifecycle(store);

  return <div className={`shell ${drawer.isOpen ? "drawer-open" : ""}`}>
    <SessionDrawer store={store} drawer={drawer}/>
    <main>
      <AuthorityBanner authority={state.authority}/>
      <ClientHeader store={store} drawer={drawer}/>
      {newSession && <NewSessionView store={store} newSession={newSession}/>}
      {!newSession && <>
        {session ? <SessionTimeline entries={timeline} olderCursor={state.olderCursors[session.sessionId]} paging={state.paging}
          loadOlder={() => store.getState().loadOlder()} presentTail={() => store.getState().presentTail()}/>
          : <section className="timeline" aria-label="Session Timeline"><div className="empty"><h2>Choose a Session</h2><p>Resume a Chat or open a Project.</p></div></section>}
        {session && <Composer store={store} sessionId={session.sessionId} draft={draft}/>}
      </>}
    </main>
  </div>;
}

function Composer({ store, sessionId, draft }: { store: ClientStore; sessionId: string; draft: string }) {
  const state = useStore(store);
  const runs = state.runs[sessionId] ?? [];
  const executing = runs.find(run => run.state === "executing" && run.workerGeneration);
  const held = runs.filter(run => run.state === "held");
  const interactions = state.interactions[sessionId] ?? [];
  const [interactionIndex, setInteractionIndex] = useState<number | null>(null);
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
    {interaction ? <InteractionControl
      interaction={interaction}
      position={interactionIndex! + 1}
      count={interactions.length}
      intentPhase={state.interactionIntents[interaction.interactionId]?.phase}
      executingRunId={executing?.runId}
      onWriteMessage={() => { setInteractionIndex(null); requestAnimationFrame(() => composer.current?.focus()); }}
      onNext={() => setInteractionIndex((interactionIndex! + 1) % interactions.length)}
      onResolve={(interactionId, resolution) => void store.getState().resolveInteraction(interactionId, resolution)}
      onStop={runId => void store.getState().stopRun(runId)}
    /> : <div className="composer-row">
      <textarea ref={composer} aria-label="Composer" value={draft} onChange={event => void store.getState().setDraft(event.target.value)} placeholder="Ask Pi…"
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/>
      <button disabled={state.authority.status !== "current" || !state.isSessionCurrent} aria-label={executing && !draft.trim() ? `Stop Run ${executing.runId}` : action} onClick={submit}>{action}</button>
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

function NewSessionView({ store, newSession }: { store: ClientStore; newSession: NewSessionState }) {
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
    <div className="new-actions"><button disabled={!editable || store.getState().authority.status !== "current"} onClick={() => void store.getState().submitNewSession(true)}>Create empty Session</button><button disabled={!editable || store.getState().authority.status !== "current"} onClick={submit}>Create &amp; Run</button></div>
  </section>;
}

function AuthorityBanner({ authority }: { authority: import("./client-store.js").AuthorityState }) {
  if (authority.status === "current") return null;
  const labels = { offline: "Offline", reconnecting: "Reconnecting", "update-required": "Update required" } as const;
  return <section className={`authority-banner ${authority.status}`} role="status" aria-live="polite">
    <strong>{labels[authority.status]}</strong>
    <span>{authority.lastSynchronizedAt
      ? `Cached facts are not current. Last authoritative synchronization: ${authority.lastSynchronizedAt}`
      : "Host authority is unavailable. No cached authoritative facts are available."}</span>
    {authority.reason && <span>{authority.reason}</span>}
  </section>;
}
