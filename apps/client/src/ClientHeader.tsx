import { useStore } from "zustand";
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
  else if (session) subtitle = `Current${session.projectId ? ` · Project ${session.projectId}` : ""}`;

  return <header>
    <SessionDrawerToggle drawer={drawer}/>
    <div className="header-title"><h1>{title}</h1><small>{subtitle}</small></div>
    {executingRun && <button className="header-stop" disabled={state.authority.status !== "current" || !state.isSessionCurrent} aria-label={`Stop Run ${executingRun.runId} from Session header`} onClick={() => void store.getState().stopRun(executingRun.runId)}>Stop</button>}
  </header>;
}
