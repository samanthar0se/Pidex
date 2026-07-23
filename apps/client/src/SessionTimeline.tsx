import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Sparkles, Terminal } from "lucide-react";
import type { TimelineFact } from "./client-store.js";
import { getTimelineEntryPresentation } from "./timeline-entry-presentation.js";
import {
  getActivityDetail,
  getActivitySummary,
  getToolCallPreview,
  projectTimelineTurns,
  type TimelinePresentationItem,
  type TimelineTurnPresentation,
} from "./timeline-turn-presentation.js";
import {
  captureVisibleTimelineAnchor,
  initialTailPosition,
  restoreVisibleTimelineAnchor,
  scrollTimelineToTail,
  shouldFollowTimelineTail,
  shouldShowJumpToLatest,
  tailPositionFromDistance,
  tailPositionFromVisibility,
  timelineDistanceFromTail,
} from "./timeline-viewport.js";

interface Props {
  entries: readonly TimelineFact[];
  olderCursor?: string | null;
  paging: "idle" | "loading" | "error";
  executingRunIds?: ReadonlySet<string>;
  loadOlder(): Promise<void>;
  presentTail(): Promise<void>;
}

/** Pidex retains identity/order authority; assistant-ui is presentation only. */
export function SessionTimeline({ entries, olderCursor, paging, executingRunIds, loadOlder, presentTail }: Props) {
  const viewport = useRef<HTMLElement>(null);
  const older = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const cancelJump = useRef<() => void>(() => {});
  const [tailPosition, setTailPosition] = useState(initialTailPosition);
  const presentation = projectTimelineTurns(entries, executingRunIds);

  async function prepend() {
    const element = viewport.current;
    const anchor = element ? captureVisibleTimelineAnchor(element) : undefined;
    await loadOlder();
    requestAnimationFrame(() => {
      if (element) restoreVisibleTimelineAnchor(element, anchor);
    });
  }

  useEffect(() => {
    if (!older.current || !olderCursor) return;
    const observer = new IntersectionObserver(items => {
      if (items.some(item => item.isIntersecting) && paging === "idle") void prepend();
    }, { root: viewport.current });
    observer.observe(older.current);
    return () => observer.disconnect();
  }, [olderCursor, paging]);

  useEffect(() => {
    if (!tail.current) return;
    const observer = new IntersectionObserver(items => {
      const visible = items.some(item => item.isIntersecting);
      const element = viewport.current;
      setTailPosition(visible || !element
        ? tailPositionFromVisibility(visible)
        : tailPositionFromDistance(timelineDistanceFromTail(element)));
      if (visible) void presentTail();
    }, { root: viewport.current, threshold: 1 });
    observer.observe(tail.current);
    return () => observer.disconnect();
  }, [entries.at(-1)?.entryId, entries.at(-1)?.revision]);

  useEffect(() => {
    if (shouldFollowTimelineTail(tailPosition)) tail.current?.scrollIntoView({ block: "end" });
  }, [entries, tailPosition]);

  useEffect(() => () => cancelJump.current(), []);

  function updateTailPosition() {
    const element = viewport.current;
    if (element) setTailPosition(tailPositionFromDistance(timelineDistanceFromTail(element)));
  }

  function interruptJump() {
    cancelJump.current();
  }

  function jumpToLatest() {
    const element = viewport.current;
    if (!element) return;
    cancelJump.current();
    cancelJump.current = scrollTimelineToTail(
      element,
      matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }

  return <>
    <section
      ref={viewport}
      className="timeline"
      aria-label="Session Timeline"
      onScroll={updateTailPosition}
      onWheel={interruptJump}
      onTouchStart={interruptJump}
      onPointerDown={interruptJump}
    >
      <div ref={older} className="paging-status">
        {paging === "loading" && "Loading older history…"}
        {paging === "error" && <><span role="alert">Older history could not be loaded.</span> <button onClick={() => void prepend()}>Try again</button></>}
        {olderCursor && paging === "idle" && <button onClick={() => void prepend()}>Load older history</button>}
      </div>
      {presentation.map(item => <TimelineItem key={presentationKey(item)} item={item}/>)}
      <div ref={tail} className="timeline-tail" aria-hidden="true"/>
    </section>
    {shouldShowJumpToLatest(tailPosition) && <button className="jump-latest" onClick={jumpToLatest}>Jump to latest</button>}
  </>;
}

function TimelineItem({ item }: { item: TimelinePresentationItem }) {
  if (item.kind === "standalone") return <TimelineEntry entry={item.entry}/>;
  return <TimelineTurn turn={item}/>;
}

function TimelineTurn({ turn }: { turn: TimelineTurnPresentation }) {
  return <article
    className="timeline-turn"
    data-turn-id={turn.turnId}
    data-run-id={turn.runId ?? undefined}
    data-phase={turn.phase}
  >
    {turn.segments.map(segment => segment.kind === "activity"
      ? <WorkDisclosure key={`activity:${segment.entries[0]!.entryId}`} entries={segment.entries} active={segment.active}/>
      : <TimelineEntry key={segment.entry.entryId} entry={segment.entry}/>)}
  </article>;
}

function WorkDisclosure({ entries, active }: { entries: readonly TimelineFact[]; active: boolean }) {
  const panelId = useId();
  const triggerId = `${panelId}-trigger`;
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? false;
  const latestTool = entries.slice().reverse().find(entry => entry.kind === "tool");
  const liveToolPreview = active && !expanded && latestTool ? getToolCallPreview(latestTool) : null;
  const countLabel = entries.length === 1 ? "1 step" : `${entries.length} steps`;

  return <section
    className="work-disclosure"
    data-active={active}
    data-expanded={expanded}
    data-manual={manualExpanded !== null}
  >
    <button
      id={triggerId}
      className="work-trigger"
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={() => setManualExpanded(!expanded)}
    >
      <span className={active ? "working-label text-shimmer" : "working-label"} aria-live="polite">
        {active ? "Working" : "Worked"}
      </span>
      {!active && <span className="work-summary">{countLabel}</span>}
      <ChevronRight className="work-chevron" aria-hidden="true"/>
    </button>
    {liveToolPreview && <div className="work-live-preview" role="status">
      <Terminal aria-hidden="true"/>
      <span>{liveToolPreview}</span>
    </div>}
    <div
      id={panelId}
      className="work-panel"
      aria-labelledby={triggerId}
      data-expanded={expanded}
      aria-hidden={!expanded}
      aria-busy={active}
      inert={!expanded ? true : undefined}
    >
      <div className="work-panel-clip">
        <ol className="activity-list">
          {entries.map(entry => <ActivityRow key={entry.entryId} entry={entry}/>)}
        </ol>
      </div>
    </div>
  </section>;
}

function ActivityRow({ entry }: { entry: TimelineFact }) {
  const detail = getActivityDetail(entry);
  const ActivityIcon = entry.kind === "tool" ? Terminal : Sparkles;
  const detailId = useId();
  const [detailExpanded, setDetailExpanded] = useState(false);
  const summary = getActivitySummary(entry);
  const toolDetail = entry.kind === "tool" && detail !== null;
  return <li
    className="activity-row"
    data-entry-id={entry.entryId}
    data-kind={entry.kind}
    data-finalized={entry.finalized}
    data-running={entry.finalized === false}
    data-detail-expanded={toolDetail ? detailExpanded : undefined}
  >
    <span className="activity-icon" aria-hidden="true"><ActivityIcon/></span>
    <div className="activity-copy">
      {toolDetail
        ? <button
            className="tool-detail-trigger"
            type="button"
            aria-expanded={detailExpanded}
            aria-controls={detailId}
            aria-label={`${detailExpanded ? "Hide" : "Show"} raw output for ${summary}`}
            onClick={() => setDetailExpanded(!detailExpanded)}
          >
            <span className="activity-summary">{summary}</span>
            <ChevronRight className="tool-detail-chevron" aria-hidden="true"/>
          </button>
        : <span className="activity-summary">{summary}</span>}
      {toolDetail
        ? <div id={detailId} className="tool-detail-panel" hidden={!detailExpanded}>
            {detailExpanded && <pre className="activity-detail">{detail}</pre>}
          </div>
        : detail && <pre className="activity-detail">{detail}</pre>}
      {entry.finalized === false && <span className="sr-only">Running</span>}
    </div>
  </li>;
}

function TimelineEntry({ entry }: { entry: TimelineFact }) {
  const presentation = getTimelineEntryPresentation(entry.kind);
  const classes = [
    "timeline-entry",
    presentation.abnormal ? "abnormal" : "",
    entry.kind === "response" ? "response-entry" : "",
    entry.kind === "response" && entry.finalized === false ? "streaming-response" : "",
  ].filter(Boolean).join(" ");
  return <div
    data-entry-id={entry.entryId}
    data-kind={entry.kind}
    data-finalized={entry.finalized}
    className={classes}
    aria-busy={entry.kind === "response" && entry.finalized === false}
  >
    {presentation.label && <small>{presentation.label}</small>}
    <NarrativeText text={entry.text}/>
    {entry.kind === "response" && <ResponseActions text={entry.text} available={entry.finalized !== false}/>}
  </div>;
}

function NarrativeText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return <div className="narrative-text">{blocks.map((block, index) =>
    <p key={`${index}:${block.slice(0, 24)}`}>{block}</p>)}</div>;
}

function ResponseActions({ text, available }: { text: string; available: boolean }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  async function copyResponse() {
    if (!await writeClipboardText(text)) return;
    setCopied(true);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 1_800);
  }

  return <div className="response-actions" data-available={available} aria-hidden={!available}>
    <button type="button" disabled={!available} tabIndex={available ? 0 : -1} onClick={() => void copyResponse()} aria-label={copied ? "Response copied" : "Copy response"} title={copied ? "Copied" : "Copy response"}>
      {copied ? <Check aria-hidden="true"/> : <Copy aria-hidden="true"/>}
    </button>
  </div>;
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  const textarea = document.createElement("textarea");
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    focused?.focus({ preventScroll: true });
  }
}

function presentationKey(item: TimelinePresentationItem): string {
  return item.kind === "turn" ? item.turnId : `standalone:${item.entry.entryId}`;
}
