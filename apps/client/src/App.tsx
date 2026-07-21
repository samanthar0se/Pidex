import { useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Menu, Plus, Search, X } from "lucide-react";
import { useStore } from "zustand";
import { store } from "./main.js";
import { selectCurrentSession, selectCurrentTimeline, selectDiscoveryGroups, selectDraft } from "./client-store.js";

function applyPath(path: string) {
  if (path === "/archived") store.setState({ discoveryMode: "archived" });
  const match = path.match(/^\/sessions\/([^/]+)$/);
  if (match) void store.getState().openSession(decodeURIComponent(match[1]), "none");
}

export function App() {
  const session = useStore(store, selectCurrentSession);
  const timeline = useStore(store, selectCurrentTimeline);
  const draft = useStore(store, selectDraft);
  const groups = useStore(store, selectDiscoveryGroups);
  const state = useStore(store);
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
      <button className="new-session"><Plus size={16}/> New Session</button>
      <label className="search"><Search size={15}/><input aria-label="Search Sessions" placeholder="Search Sessions" value={state.searchQuery} onChange={event => store.getState().setSearchQuery(event.target.value)}/></label>
      <nav aria-label={state.discoveryMode === "archived" ? "Archived Sessions" : "Sessions"}>
        {groups.map(group => {
          const expanded = searching || group.id === "chats" || state.expandedProjectIds.includes(group.id);
          return <section className="discovery-group" key={group.id}>
            <button className="group-heading" aria-expanded={expanded} onClick={() => group.id !== "chats" && void store.getState().toggleProject(group.id)}>
              {group.id !== "chats" && (expanded ? <ChevronDown/> : <ChevronRight/>)}<span>{group.name}</span>
            </button>
            {expanded && group.sessions.map(item => <div className="session-row" key={item.sessionId}>
              <button className="session-link" aria-current={state.selectedSessionId === item.sessionId ? "page" : undefined}
                aria-label={`${item.name}${item.readState?.readStatus === "unread" ? ", Unread" : ""}${item.attention === "working" ? ", Working" : item.attention === "needs-response" ? ", Needs response" : ""}`}
                onClick={() => choose(item.sessionId)}>
                <span className="session-name">{item.name}</span><span className="cues" aria-hidden="true">{item.readState?.readStatus === "unread" && <i className="unread"/>}{item.attention === "working" && "Working"}{item.attention === "needs-response" && "Needs response"}</span>
              </button>
              {state.discoveryMode === "archived" && <button className="restore" onClick={() => void store.getState().restoreSession(item.sessionId)}>Restore</button>}
            </div>)}
          </section>;
        })}
        {groups.length === 0 && <p className="no-results">No matching Sessions</p>}
      </nav>
      <button className="archived" aria-pressed={state.discoveryMode === "archived"} onClick={() => store.getState().setDiscoveryMode(state.discoveryMode === "archived" ? "available" : "archived")}><Archive size={16}/>{state.discoveryMode === "archived" ? "Back to Sessions" : "Archived"}</button>
    </aside>
    <main>
      <header><button ref={drawerToggle} className="menu" aria-label="Open Session drawer" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu/></button><div><h1>{session?.name ?? (state.discoveryMode === "archived" ? "Archived Sessions" : "Pidex")}</h1><small>{session && (state.isSessionCurrent ? "Current" : "Reconciling current Host data")}</small></div></header>
      <section className="timeline" aria-label="Session Timeline">
        {!session && <div className="empty"><h2>Choose a Session</h2><p>Resume a Chat or open a Project.</p></div>}
        {timeline.map(entry => <article key={entry.entryId} data-kind={entry.kind}><small>{entry.kind}</small>{entry.text}</article>)}
      </section>
      {session && <footer><textarea aria-label="Composer" value={draft} onChange={event => void store.getState().setDraft(event.target.value)} placeholder="Ask Pi…"/><button>Run</button></footer>}
    </main>
  </div>;
}
