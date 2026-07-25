import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Archive, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Folder, LoaderCircle, Menu, MessageSquarePlus, Search, X } from "lucide-react";
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

/** Coarse clock backing relative recency copy; row detail never needs finer. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function SessionDrawerToggle({ drawer }: { drawer: SessionDrawerController }) {
  return <button ref={drawer.toggleRef} className="menu" aria-label="Open Session drawer" aria-expanded={drawer.isOpen} onClick={drawer.open}><Menu/></button>;
}

/**
 * The four discovery row states. `blocked` and `working` project the Session
 * attention summary; `review` projects unread on an otherwise quiet Session.
 * Read status stays an independent channel, so an unread `working` or
 * `blocked` row still carries its own unread emphasis.
 */
type SessionRowState = "blocked" | "working" | "review" | "idle";

const ROW_STATE_LABEL: Record<SessionRowState, string> = {
  blocked: "Blocked",
  working: "Working",
  review: "Review",
  idle: "",
};

const ROW_STATE_ICON: Record<SessionRowState, typeof CircleAlert | undefined> = {
  blocked: CircleAlert,
  working: LoaderCircle,
  review: CircleCheck,
  idle: undefined,
};

/** Precedence: `needs response` over `working` over unread over quiet. */
export function sessionRowState(session: SessionFact): SessionRowState {
  if (session.attention === "needs-response") return "blocked";
  if (session.attention === "working") return "working";
  return session.readState?.readStatus === "unread" ? "review" : "idle";
}

/**
 * A settling Run reaches the row as two exact facts — the attention summary
 * first, then the unread milestone — before the reader's own presentation can
 * answer either. The row therefore holds `working` across the settlement and
 * presents whatever is true once it lands, so a reader who is already watching
 * sees `working → idle` instead of a Review flash. `needs response` is never
 * held: it blocks the reader now.
 */
export const reviewHoldMs = 700;

export function holdsSettlingRun(presented: SessionRowState, next: SessionRowState): boolean {
  return presented === "working" && next !== "working" && next !== "blocked";
}

/** Presents the row state, holding `working` while a Run's settlement lands. */
function useHeldRowState(session: SessionFact): SessionRowState {
  const next = sessionRowState(session);
  const [presented, setPresented] = useState(next);

  useEffect(() => {
    if (!holdsSettlingRun(presented, next)) {
      setPresented(next);
      return;
    }
    const timer = setTimeout(() => setPresented(next), reviewHoldMs);
    return () => clearTimeout(timer);
  }, [next, presented]);

  return presented;
}

/** Under a minute the token is `now`, which needs prose rather than an `ago` suffix. */
function describeElapsed(recency: string): string {
  return recency === "now" ? "just now" : `${recency} ago`;
}

function describeRecency(at: number | undefined, now: number): string | undefined {
  if (at === undefined) return undefined;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** The row's second line: current activity, blocking reason, or plain recency. */
function describeRowDetail(session: SessionFact, state: SessionRowState, now: number): string | undefined {
  const recency = describeRecency(session.activity?.at, now);
  if (state === "working" || state === "blocked") return session.activity?.detail ?? recency;
  if (state === "review") return recency ? `Finished ${describeElapsed(recency)}` : "Unread updates";
  return recency;
}

function describeSessionCues(session: SessionFact, state: SessionRowState, holding = false) {
  // A held row has not presented its unread milestone yet, so the independent
  // unread emphasis waits with it rather than leaking the transition early.
  const unread = session.readState?.readStatus === "unread" && !holding;
  const labels = [ROW_STATE_LABEL[state] || undefined, unread ? "Unread" : undefined]
    .filter((label): label is string => Boolean(label));
  return { unread, accessibleName: [session.name, ...labels].join(", ") };
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

function SessionRow({ session, now, selected, restorable, choose, restore }: {
  session: SessionFact;
  now: number;
  selected: boolean;
  restorable: boolean;
  choose: () => void;
  restore: () => void;
}) {
  const rowState = useHeldRowState(session);
  const cues = describeSessionCues(session, rowState, rowState !== sessionRowState(session));
  const detail = describeRowDetail(session, rowState, now);
  const StateIcon = ROW_STATE_ICON[rowState];
  return <div className="session-row">
    <button className="session-link" data-state={rowState} data-unread={cues.unread || undefined}
      aria-current={selected ? "page" : undefined}
      aria-label={cues.accessibleName} onClick={choose}>
      <span className="session-state-icon" aria-hidden="true">{StateIcon && <StateIcon/>}</span>
      <span className="session-copy">
        <span className="session-name">{session.name}</span>
        {detail && <span className="session-detail">{detail}</span>}
      </span>
      <span className="cues" aria-hidden="true">
        {ROW_STATE_LABEL[rowState] && <span className="session-state-label">{ROW_STATE_LABEL[rowState]}</span>}
        {cues.unread && rowState !== "review" && <i className="unread"/>}
      </span>
    </button>
    {restorable && <button className="restore" onClick={restore}>Restore</button>}
  </div>;
}

export function SessionDrawer({ store, drawer }: { store: ClientStore; drawer: SessionDrawerController }) {
  const state = useStore(store);
  const now = useNow();
  const groups = selectDiscoveryGroups(state);
  const projectGroups = groups.filter(group => group.id !== "chats");
  const chats = groups.find(group => group.id === "chats");
  const searching = state.searchQuery.trim() !== "";
  const chooseSession = (sessionId: string) => {
    void store.getState().openSession(sessionId, "push");
    drawer.close();
  };
  const sessionRows = (sessions: readonly SessionFact[]) => sessions.map(session =>
    <SessionRow key={session.sessionId} session={session} now={now}
      selected={state.selectedSessionId === session.sessionId}
      restorable={state.discoveryMode === "archived"}
      choose={() => chooseSession(session.sessionId)}
      restore={() => void store.getState().restoreSession(session.sessionId)}/>);

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
