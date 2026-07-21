import { useEffect } from "react";
import { Menu, Plus } from "lucide-react";
import { useStore } from "zustand";
import { store } from "./main.js";
import {
  selectCurrentSession,
  selectCurrentTimeline,
  selectDraft,
  type NewSessionProgress,
  type NewSessionState,
} from "./client-store.js";

export function App() {
  const session = useStore(store, selectCurrentSession);
  const timeline = useStore(store, selectCurrentTimeline);
  const draft = useStore(store, selectDraft);
  const isSessionCurrent = useStore(store, state => state.isSessionCurrent);
  const newSession = useStore(store, state => state.newSession);
  useEffect(() => {
    if (location.pathname === "/new") {
      void store.getState().openNewSession();
      return;
    }
    const match = location.pathname.match(/^\/sessions\/([^/]+)$/);
    if (match) void store.getState().openSession(decodeURIComponent(match[1]));
  }, []);
  return <div className="shell">
    <aside><strong>PIDEX</strong><button onClick={() => void store.getState().openNewSession()}><Plus size={16}/> New Session</button><nav>Chats</nav></aside>
    <main>
      <header><button className="menu" aria-label="Open Session drawer"><Menu/></button><div><h1>{newSession ? "New Session" : session?.name ?? "Pidex"}</h1><small>{newSession ? "Nothing is created until you submit" : isSessionCurrent ? "Current" : "Reconciling current Host data"}</small></div></header>
      {newSession && <NewSessionView newSession={newSession}/>}
      {!newSession && <>
      <section className="timeline" aria-label="Session Timeline">
        {timeline.map(entry => <article key={entry.entryId} data-kind={entry.kind}><small>{entry.kind}</small>{entry.text}</article>)}
      </section>
      {session && <footer><textarea aria-label="Composer" value={draft} onChange={event => void store.getState().setDraft(event.target.value)} placeholder="Ask Pi…"/><button>Run</button></footer>}
      </>}
    </main>
  </div>;
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
