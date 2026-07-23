import { useStore } from "zustand";
import { Folder, MessageSquare, Square } from "lucide-react";
import type { ClientStore } from "./client-store.js";
import { selectCurrentSession } from "./client-store.js";
import { SessionDrawerToggle, type SessionDrawerController } from "./SessionDrawer.js";

export function ClientHeader({ store, drawer }: { store: ClientStore; drawer: SessionDrawerController }) {
  const state = useStore(store);
  const session = selectCurrentSession(state);
  const executingRun = session && (state.runs[session.sessionId] ?? []).find(run => run.state === "executing" && run.workerGeneration);
  const title = state.newSession
    ? "New Session"
    : session?.name ?? (state.discoveryMode === "archived" ? "Archived Sessions" : "Pidex");

  let subtitle: string | undefined;
  if (state.newSession) subtitle = "Nothing is created until you submit";
  else if (session && !state.isSessionCurrent) subtitle = "Reconciling current Host data";
  else if (session) subtitle = session.projectId ? `Project ${session.projectId}` : "Unscoped Session";

  return <header>
    <SessionDrawerToggle drawer={drawer}/>
    <div className="header-icon" aria-hidden="true">{session?.projectId ? <Folder/> : <MessageSquare/>}</div>
    <div className="header-title"><h1>{title}</h1>{subtitle && <small>{subtitle}</small>}</div>
    {executingRun && <button className="header-stop" disabled={state.authority.status !== "current" || !state.isSessionCurrent} aria-label={`Stop Run ${executingRun.runId} from Session header`} onClick={() => void store.getState().stopRun(executingRun.runId)}><Square size={12} fill="currentColor"/> Stop</button>}
  </header>;
}
