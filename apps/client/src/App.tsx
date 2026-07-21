import { useEffect } from "react";
import { Menu, Plus } from "lucide-react";
import { useStore } from "zustand";
import { store } from "./main.js";
import { selectCurrentSession, selectCurrentTimeline, selectDraft } from "./client-store.js";
import { SessionTimeline } from "./SessionTimeline.js";

export function App() {
  const session = useStore(store, selectCurrentSession);
  const timeline = useStore(store, selectCurrentTimeline);
  const draft = useStore(store, selectDraft);
  const isSessionCurrent = useStore(store, state => state.isSessionCurrent);
  const olderCursor = useStore(store, state => session ? state.olderCursors[session.sessionId] : null);
  const paging = useStore(store, state => state.paging);
  useEffect(() => {
    const match = location.pathname.match(/^\/sessions\/([^/]+)$/);
    if (match) void store.getState().openSession(decodeURIComponent(match[1]));
  }, []);
  return <div className="shell">
    <aside><strong>PIDEX</strong><button><Plus size={16}/> New Session</button><nav>Chats</nav></aside>
    <main>
      <header><button className="menu" aria-label="Open Session drawer"><Menu/></button><div><h1>{session?.name ?? "Pidex"}</h1><small>{isSessionCurrent ? "Current" : "Reconciling current Host data"}</small></div></header>
      <SessionTimeline entries={timeline} olderCursor={olderCursor} paging={paging}
        loadOlder={() => store.getState().loadOlder()} presentTail={() => store.getState().presentTail()}/>
      {session && <footer><textarea aria-label="Composer" value={draft} onChange={event => void store.getState().setDraft(event.target.value)} placeholder="Ask Pi…"/><button>Run</button></footer>}
    </main>
  </div>;
}
