import { useEffect, useRef, useState } from "react";
import type { TimelineFact } from "./client-store.js";

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
  const [following, setFollowing] = useState(true);

  async function prepend() {
    const element = viewport.current;
    const anchor = element?.querySelector<HTMLElement>("[data-entry-id]");
    const before = anchor?.getBoundingClientRect().top;
    await loadOlder();
    requestAnimationFrame(() => {
      if (element && anchor && before !== undefined) element.scrollTop += anchor.getBoundingClientRect().top - before;
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
      setFollowing(visible);
      if (visible) void presentTail();
    }, { root: viewport.current, threshold: 1 });
    observer.observe(tail.current);
    return () => observer.disconnect();
  }, [entries.at(-1)?.entryId, entries.at(-1)?.revision]);

  useEffect(() => {
    if (following) tail.current?.scrollIntoView({ block: "end" });
  }, [entries, following]);

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
    {!following && <button className="jump-latest" onClick={() => tail.current?.scrollIntoView({ behavior: "smooth" })}>Jump to latest</button>}
  </>;
}

function TimelineEntry({ entry }: { entry: TimelineFact }) {
  const abnormal = entry.kind === "outcome" || entry.kind === "lifecycle" || entry.kind === "interaction";
  if (entry.kind === "assistant" || entry.kind === "tool") {
    return <details className="work" data-entry-id={entry.entryId} data-finalized={entry.finalized}>
      <summary>{entry.kind === "tool" ? "Tool activity" : "Work"}{entry.finalized === false ? " · working" : ""}</summary>
      <pre>{entry.text}</pre>
    </details>;
  }
  return <article data-entry-id={entry.entryId} data-kind={entry.kind} className={abnormal ? "abnormal" : undefined}>
    {entry.kind !== "response" && <small>{entry.kind}</small>}
    {entry.text}
  </article>;
}
