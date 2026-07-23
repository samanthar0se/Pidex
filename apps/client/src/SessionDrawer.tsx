import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Archive, ChevronDown, ChevronRight, Folder, Menu, MessageSquarePlus, Search, X } from "lucide-react";
import { useStore } from "zustand";
import type { ClientStore, SessionFact } from "./client-store.js";
import { selectDiscoveryGroups } from "./client-store.js";

export type SessionDrawerController = {
  isOpen: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  closeRef: RefObject<HTMLButtonElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  open: () => void;
  close: () => void;
};

export function useSessionDrawer(): SessionDrawerController {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  const open = () => {
    setIsOpen(true);
    requestAnimationFrame(() => closeRef.current?.focus());
  };
  const close = () => {
    setIsOpen(false);
    requestAnimationFrame(() => toggleRef.current?.focus());
  };

  return { isOpen, toggleRef, closeRef, searchRef, open, close };
}

export function SessionDrawerToggle({ drawer }: { drawer: SessionDrawerController }) {
  return <button ref={drawer.toggleRef} className="menu" aria-label="Open Session drawer" aria-expanded={drawer.isOpen} onClick={drawer.open}><Menu/></button>;
}

function describeSessionCues(session: SessionFact) {
  const unread = session.readState?.readStatus === "unread";
  let attention: string | undefined;
  if (session.attention === "working") attention = "Working";
  if (session.attention === "needs-response") attention = "Needs response";

  const labels = [unread ? "Unread" : undefined, attention].filter((label): label is string => Boolean(label));
  return { unread, attention, accessibleName: [session.name, ...labels].join(", ") };
}

function handleNavigationKey(event: ReactKeyboardEvent<HTMLElement>) {
  const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".group-heading, .session-link")];
  const focusedIndex = controls.indexOf(document.activeElement as HTMLButtonElement);
  if (focusedIndex < 0) return;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(controls.length - 1, focusedIndex + offset));
    controls[nextIndex]?.focus();
  }

  const focused = controls[focusedIndex];
  if (!focused?.classList.contains("group-heading")) return;
  const opensGroup = event.key === "ArrowRight" && focused.getAttribute("aria-expanded") === "false";
  const closesGroup = event.key === "ArrowLeft" && focused.getAttribute("aria-expanded") === "true";
  if (!opensGroup && !closesGroup) return;
  event.preventDefault();
  focused.click();
}

export function SessionDrawer({ store, drawer }: { store: ClientStore; drawer: SessionDrawerController }) {
  const state = useStore(store);
  const groups = selectDiscoveryGroups(state);
  const projectGroups = groups.filter(group => group.id !== "chats");
  const chats = groups.find(group => group.id === "chats");
  const searching = state.searchQuery.trim() !== "";
  const chooseSession = (sessionId: string) => {
    void store.getState().openSession(sessionId, "push");
    drawer.close();
  };
  const sessionRows = (sessions: readonly SessionFact[]) => sessions.map(session => {
    const cues = describeSessionCues(session);
    return <div className="session-row" key={session.sessionId}>
      <button className={`session-link ${session.attention === "working" ? "session-working" : ""}`} aria-current={state.selectedSessionId === session.sessionId ? "page" : undefined}
        aria-label={cues.accessibleName} onClick={() => chooseSession(session.sessionId)}>
        <span className="session-name">{session.name}</span>
        <span className="cues" aria-hidden="true">{session.attention !== "quiet" && <i className={`attention-dot ${session.attention ?? "quiet"}`}/>} {cues.unread && <i className="unread"/>}</span>
      </button>
      {state.discoveryMode === "archived" && <button className="restore" onClick={() => void store.getState().restoreSession(session.sessionId)}>Restore</button>}
    </div>;
  });

  return <>
    <button className="drawer-backdrop" aria-label="Close Session drawer" onClick={drawer.close}/>
    <aside aria-label="Session drawer" onKeyDown={event => { if (event.key === "Escape") drawer.close(); }}>
      <div className="brand"><strong>Pidex</strong><ChevronDown className="brand-chevron" aria-hidden="true"/><button ref={drawer.closeRef} className="close-drawer" aria-label="Close Session drawer" onClick={drawer.close}><X/></button></div>
      <div className="rail-actions">
        <button className="new-session-button" onClick={() => { void store.getState().openNewSession(); drawer.close(); }}><MessageSquarePlus size={16}/> <strong>New Session</strong></button>
        <button className="archived" aria-pressed={state.discoveryMode === "archived"} onClick={() => store.getState().setDiscoveryMode(state.discoveryMode === "archived" ? "available" : "archived")}><Archive size={16}/>{state.discoveryMode === "archived" ? "Back to Sessions" : "Archived"}</button>
      </div>
      <label className="search"><Search size={15}/><input ref={drawer.searchRef} aria-label="Search Sessions" placeholder="Search Sessions" value={state.searchQuery} onChange={event => store.getState().setSearchQuery(event.target.value)} onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (state.searchQuery) store.getState().setSearchQuery("");
        else document.querySelector<HTMLButtonElement>('.session-link[aria-current="page"]')?.focus();
      }}/></label>
      <nav aria-label={state.discoveryMode === "archived" ? "Archived Sessions" : "Sessions"} onKeyDown={handleNavigationKey}>
        {projectGroups.length > 0 && <p className="nav-section-label">Projects</p>}
        {projectGroups.map(group => {
          const expanded = searching || group.id === "chats" || state.expandedProjectIds.includes(group.id);
          return <section className="discovery-group" key={group.id}>
            <button className="group-heading" aria-expanded={expanded} onClick={() => group.id !== "chats" && void store.getState().toggleProject(group.id)}>
              {expanded ? <ChevronDown/> : <ChevronRight/>}<Folder className="group-folder"/><span>{group.name}</span>
            </button>
            {expanded && sessionRows(group.sessions)}
          </section>;
        })}
        {chats && <section className="discovery-group chats-group"><p className="nav-section-label">Chats</p>{sessionRows(chats.sessions)}</section>}
        {groups.length === 0 && <p className="no-results">No matching Sessions</p>}
      </nav>
      <div className="rail-footer"><div className="host-state"><i/><span><strong>{state.authority.status === "current" ? "Host connected" : state.authority.status}</strong><small>{state.authority.status === "current" ? "This Anonymous Client is current" : "Authoritative controls unavailable"}</small></span></div></div>
    </aside>
  </>;
}
