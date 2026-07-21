import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Archive, ChevronDown, ChevronRight, Menu, Plus, Search, X } from "lucide-react";
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
  const searching = state.searchQuery.trim() !== "";
  const chooseSession = (sessionId: string) => {
    void store.getState().openSession(sessionId, "push");
    drawer.close();
  };

  return <>
    <button className="drawer-backdrop" aria-label="Close Session drawer" onClick={drawer.close}/>
    <aside aria-label="Session drawer" onKeyDown={event => { if (event.key === "Escape") drawer.close(); }}>
      <div className="brand"><strong>PIDEX</strong><button ref={drawer.closeRef} className="close-drawer" aria-label="Close Session drawer" onClick={drawer.close}><X/></button></div>
      <button className="new-session-button" onClick={() => { void store.getState().openNewSession(); drawer.close(); }}><Plus size={16}/> New Session</button>
      <label className="search"><Search size={15}/><input ref={drawer.searchRef} aria-label="Search Sessions" placeholder="Search Sessions" value={state.searchQuery} onChange={event => store.getState().setSearchQuery(event.target.value)} onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (state.searchQuery) store.getState().setSearchQuery("");
        else document.querySelector<HTMLButtonElement>('.session-link[aria-current="page"]')?.focus();
      }}/></label>
      <nav aria-label={state.discoveryMode === "archived" ? "Archived Sessions" : "Sessions"} onKeyDown={handleNavigationKey}>
        {groups.map(group => {
          const expanded = searching || group.id === "chats" || state.expandedProjectIds.includes(group.id);
          return <section className="discovery-group" key={group.id}>
            <button className="group-heading" aria-expanded={expanded} onClick={() => group.id !== "chats" && void store.getState().toggleProject(group.id)}>
              {group.id !== "chats" && (expanded ? <ChevronDown/> : <ChevronRight/>)}<span>{group.name}</span>
            </button>
            {expanded && group.sessions.map(session => {
              const cues = describeSessionCues(session);
              return <div className="session-row" key={session.sessionId}>
                <button className="session-link" aria-current={state.selectedSessionId === session.sessionId ? "page" : undefined}
                  aria-label={cues.accessibleName} onClick={() => chooseSession(session.sessionId)}>
                  <span className="session-name">{session.name}</span><span className="cues" aria-hidden="true">{cues.unread && <i className="unread"/>}{cues.attention}</span>
                </button>
                {state.discoveryMode === "archived" && <button className="restore" onClick={() => void store.getState().restoreSession(session.sessionId)}>Restore</button>}
              </div>;
            })}
          </section>;
        })}
        {groups.length === 0 && <p className="no-results">No matching Sessions</p>}
      </nav>
      <button className="archived" aria-pressed={state.discoveryMode === "archived"} onClick={() => store.getState().setDiscoveryMode(state.discoveryMode === "archived" ? "available" : "archived")}><Archive size={16}/>{state.discoveryMode === "archived" ? "Back to Sessions" : "Archived"}</button>
    </aside>
  </>;
}
