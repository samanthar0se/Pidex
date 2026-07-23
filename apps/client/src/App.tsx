import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
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
import {
  MAX_RUN_INPUT_IMAGES,
  runInputImageSchema,
  type RunInputImage,
} from "../../../packages/protocol/src/input-image.js";

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
          executingRunIds={new Set((state.runs[session.sessionId] ?? []).filter(run => run.state === "executing").map(run => run.runId))}
          loadOlder={() => store.getState().loadOlder()} presentTail={() => store.getState().presentTail()}/>
          : <section className="timeline" aria-label="Session Timeline"><div className="empty"><h2>Choose a Session</h2><p>Resume a Chat or open a Project.</p></div></section>}
        {session && <Composer store={store} sessionId={session.sessionId} draft={draft}/>}
      </>}
    </main>
  </div>;
}

function Composer({ store, sessionId, draft }: { store: ClientStore; sessionId: string; draft: string }) {
  const state = useStore(store);
  const images = state.draftImages[sessionId] ?? [];
  const runs = state.runs[sessionId] ?? [];
  const executing = runs.find(run => run.state === "executing" && run.workerGeneration);
  const held = runs.filter(run => run.state === "held");
  const interactions = state.interactions[sessionId] ?? [];
  const [interactionIndex, setInteractionIndex] = useState<number | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!interactions.length) { setInteractionIndex(null); return; }
    if (interactionIndex !== null && interactionIndex < interactions.length) return;
    if (!draft && images.length === 0 && document.activeElement !== composer.current) {
      setInteractionIndex(0);
    }
  }, [interactions, interactionIndex, draft, images.length]);
  const interaction = interactionIndex === null ? undefined : interactions[interactionIndex];
  const hasInput = Boolean(draft.trim()) || images.length > 0;
  const action = executing ? (hasInput ? "Send" : "Stop") : "Run";
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
    /> : <>
      <ImageAttachments images={images} onRemove={index => store.getState().removeDraftImage(index)}/>
      <div className="composer-row">
        <textarea ref={composer} aria-label="Composer" value={draft} onChange={event => void store.getState().setDraft(event.target.value)} placeholder="Ask Pi…"
          onPaste={event => pasteImages(event, images.length, pasted => store.getState().addDraftImages(pasted))}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/>
        <button disabled={state.authority.status !== "current" || !state.isSessionCurrent} aria-label={executing && !hasInput ? `Stop Run ${executing.runId}` : action} onClick={submit}>{action}</button>
      </div>
    </>}
    {state.commandOutcomes.map(outcome => <p key={outcome.commandId} className={`command-outcome ${outcome.phase}`} role="status">
      {outcome.action} · {outcome.phase}{outcome.reason ? `: ${outcome.reason}` : ""}
    </p>)}
  </footer>;
}

interface NewSessionDescription {
  reason?: string;
  uncertain?: boolean;
  sessionCreated?: string;
  status?: string;
}

function describeProgress(progress: NewSessionProgress): NewSessionDescription {
  switch (progress.phase) {
    case "editing":
      return { reason: progress.reason };
    case "creating":
      return { status: "Creating Session…" };
    case "submitting-run":
      return { status: "Starting initial Run…" };
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
  const images = newSession.images ?? [];
  return <section className="new-session" aria-label="New Session">
    <div className="new-session-center"><div className="new-session-glyph" aria-hidden="true">›_</div><h2>What should we work on?</h2>
    <div className="scope-controls">
      <label><span>Project</span><input disabled={!editable} value={newSession.projectId ?? ""} placeholder="No Project" onChange={event => void store.getState().setNewSessionScope({ projectId: event.target.value || undefined, workspaceId: undefined })}/></label>
      <label><span>Workspace</span><input disabled={!editable} value={newSession.workspaceId ?? ""} placeholder="No Workspace" onChange={event => void store.getState().setNewSessionScope({ projectId: newSession.projectId, workspaceId: event.target.value || undefined })}/></label>
    </div>
    <label className="new-composer"><span className="sr-only">First prompt</span>
      <textarea autoFocus aria-label="First prompt" placeholder="Ask Pidex to do anything" value={newSession.draft} disabled={!editable}
        onChange={event => void store.getState().setNewSessionDraft(event.target.value)}
        onPaste={event => pasteImages(event, images.length, pasted => store.getState().addNewSessionImages(pasted))}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/>
      <div className="new-composer-toolbar"><span>Host default · Auto</span><button className="new-submit" disabled={!editable || (!newSession.draft.trim() && images.length === 0) || store.getState().authority.status !== "current"} onClick={submit} aria-label="Create and Run"><ArrowUp size={17}/></button></div>
    </label>
    <ImageAttachments images={images} onRemove={index => store.getState().removeNewSessionImage(index)}/>
    {description.reason && <p className="creation-outcome" role="alert">{description.uncertain ? "Outcome uncertain; do not retry. " : ""}{description.reason}</p>}
    {description.sessionCreated && <p>{description.sessionCreated}</p>}
    <button className="create-empty" disabled={!editable || store.getState().authority.status !== "current"} onClick={() => void store.getState().submitNewSession(true)}>Create empty Session</button>
    <p className="new-note">Scope and draft stay with this Client until creation succeeds.</p></div>
  </section>;
}

function ImageAttachments({
  images,
  onRemove,
}: {
  images: readonly RunInputImage[];
  onRemove(index: number): void;
}) {
  if (images.length === 0) return null;
  return <div className="image-attachments" aria-label="Attached images">
    {images.map((image, index) =>
      <div className="image-attachment" key={`${image.mimeType}:${image.data.slice(0, 32)}:${index}`}>
        <img
          alt={`Pasted image ${index + 1}`}
          src={`data:${image.mimeType};base64,${image.data}`}
        />
        <button
          type="button"
          aria-label={`Remove pasted image ${index + 1}`}
          onClick={() => onRemove(index)}
        >×</button>
      </div>
    )}
  </div>;
}

function pasteImages(
  event: React.ClipboardEvent<HTMLTextAreaElement>,
  existingCount: number,
  onImages: (images: RunInputImage[]) => void,
): void {
  const available = MAX_RUN_INPUT_IMAGES - existingCount;
  if (available <= 0) return;
  const files = Array.from(event.clipboardData.items)
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
    .slice(0, available);
  if (files.length === 0) return;
  event.preventDefault();
  void Promise.all(files.map(readClipboardImage)).then(images => {
    const valid = images.filter(
      (image): image is RunInputImage => image !== undefined,
    );
    if (valid.length > 0) onImages(valid);
  });
}

async function readClipboardImage(
  file: File,
): Promise<RunInputImage | undefined> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("clipboard-image-read-failed"))
    );
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("clipboard-image-read-failed"))
    );
    reader.readAsDataURL(file);
  }).catch(() => undefined);
  if (!dataUrl) return undefined;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return undefined;
  const parsed = runInputImageSchema.safeParse({
    type: "image",
    mimeType: match[1]?.toLowerCase(),
    data: match[2],
  });
  return parsed.success ? parsed.data : undefined;
}

function AuthorityBanner({ authority }: { authority: import("./client-store.js").AuthorityState }) {
  if (authority.status === "current") return null;
  const labels = { offline: "Offline", reconnecting: "Reconnecting", "update-required": "Update required" } as const;
  return <section className={`authority-banner ${authority.status}`} role="status" aria-live="polite">
    <strong>{labels[authority.status]}</strong>
    <span>{authority.lastSynchronizedAt
      ? `Cached Host facts are stale, incomplete, and read-only. Last synchronized: ${authority.lastSynchronizedAt}`
      : "Host authority is unavailable. No cached authoritative facts are available."}</span>
    {authority.reason && <span>{authority.reason}</span>}
  </section>;
}
