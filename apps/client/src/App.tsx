import { useEffect } from "react";
import { Menu, Plus } from "lucide-react";
import { useStore } from "zustand";
import { store } from "./main.js";
import { selectCurrentSession, selectCurrentTimeline, selectDraft } from "./client-store.js";

export function App() {
  const session = useStore(store, selectCurrentSession);
  const timeline = useStore(store, selectCurrentTimeline);
  const draft = useStore(store, selectDraft);
  const current = useStore(store, state => state.current);
  useEffect(() => {
    const match = location.pathname.match(/^\/sessions\/([^/]+)$/);
    if (match) void store.getState().openSession(decodeURIComponent(match[1]));
  }, []);
  return <div className="shell">
    <aside><strong>PIDEX</strong><button><Plus size={16}/> New Session</button><nav>Chats</nav></aside>
    <main>
      <header><button className="menu" aria-label="Open Session drawer"><Menu/></button><div><h1>{session?.name ?? "Pidex"}</h1><small>{current ? "Current" : "Reconciling current Host data"}</small></div></header>
      <section className="timeline" aria-label="Session Timeline">
        {timeline.map(entry => <article key={entry.entryId} data-kind={entry.kind}><small>{entry.kind}</small>{entry.text}</article>)}
      </section>
      {session && <footer><textarea aria-label="Composer" value={draft} onChange={event => void store.getState().setDraft(event.target.value)} placeholder="Ask Pi…"/><button>Run</button></footer>}
    </main>
  </div>;
}
