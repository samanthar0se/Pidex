import { useEffect, useRef, useState } from "react";
import type { TimelineFact } from "./client-store.js";
import { getTimelineEntryPresentation } from "./timeline-entry-presentation.js";
import {
  captureVisibleTimelineAnchor,
  initialTailPosition,
  restoreVisibleTimelineAnchor,
  shouldFollowTimelineTail,
  shouldShowJumpToLatest,
  tailPositionFromVisibility,
} from "./timeline-viewport.js";

interface Props {
  entries: readonly TimelineFact[];
  olderCursor?: string | null;
  paging: "idle" | "loading" | "error";
  loadOlder(): Promise<void>;
  presentTail(): Promise<void>;
}

/** Pidex retains identity/order authority; assistant-ui is presentation only. */
export function SessionTimeline({ entries, olderCursor, paging, loadOlder, presentTail }: Props) {
  const viewport = useRef<HTMLElement>(null);
  const older = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const [tailPosition, setTailPosition] = useState(initialTailPosition);

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
      setTailPosition(tailPositionFromVisibility(visible));
      if (visible) void presentTail();
    }, { root: viewport.current, threshold: 1 });
    observer.observe(tail.current);
    return () => observer.disconnect();
  }, [entries.at(-1)?.entryId, entries.at(-1)?.revision]);

  useEffect(() => {
    if (shouldFollowTimelineTail(tailPosition)) tail.current?.scrollIntoView({ block: "end" });
  }, [entries, tailPosition]);

  return <>
    <section ref={viewport} className="timeline" aria-label="Session Timeline">
      <div ref={older} className="paging-status">
        {paging === "loading" && "Loading older history…"}
        {paging === "error" && <><span role="alert">Older history could not be loaded.</span> <button onClick={() => void prepend()}>Try again</button></>}
        {olderCursor && paging === "idle" && <button onClick={() => void prepend()}>Load older history</button>}
      </div>
      {entries.map(entry => <TimelineEntry key={entry.entryId} entry={entry}/>)}
      <div ref={tail} className="timeline-tail" aria-hidden="true"/>
    </section>
    {shouldShowJumpToLatest(tailPosition) && <button className="jump-latest" onClick={() => tail.current?.scrollIntoView({ behavior: "smooth" })}>Jump to latest</button>}
  </>;
}

function TimelineEntry({ entry }: { entry: TimelineFact }) {
  const presentation = getTimelineEntryPresentation(entry.kind);
  if (presentation.layout === "work") {
    return <details className="work" data-entry-id={entry.entryId} data-finalized={entry.finalized}>
      <summary>{presentation.label}{entry.finalized === false ? " · working" : ""}</summary>
      <pre>{entry.text}</pre>
    </details>;
  }
  return <article data-entry-id={entry.entryId} data-kind={entry.kind} className={presentation.abnormal ? "abnormal" : undefined}>
    {presentation.label && <small>{presentation.label}</small>}
    {entry.text}
  </article>;
}
