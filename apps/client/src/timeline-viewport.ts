export type TimelineTailPosition = "unobserved" | "following" | "detached";

export const initialTailPosition: TimelineTailPosition = "unobserved";
export const timelineFollowThresholdPx = 24;
export const timelineJumpDurationMs = 260;

export function tailPositionFromVisibility(visible: boolean): TimelineTailPosition {
  return visible ? "following" : "detached";
}

export function timelineDistanceFromTail(viewport: HTMLElement): number {
  return Math.max(0, viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop);
}

export function tailPositionFromDistance(distanceFromTailPx: number): TimelineTailPosition {
  return distanceFromTailPx <= timelineFollowThresholdPx ? "following" : "detached";
}

export function shouldFollowTimelineTail(position: TimelineTailPosition): boolean {
  return position === "following";
}

export function shouldShowJumpToLatest(position: TimelineTailPosition): boolean {
  return position === "detached";
}

/**
 * Quiet presentation a visible tail must hold before its revision counts as
 * read. Arriving content is not read content: a streaming Run advances the
 * Timeline revision many times a second, and a Run that settles as the reader
 * leaves must keep its unread milestone (FX-STATE-02).
 */
export const tailPresentationDwellMs = 500;

export interface TailPresentation {
  /** Re-arms the dwell for the currently presented tail. */
  observe(observation: { tailVisible: boolean; documentVisible: boolean }): void;
  /** Abandons any pending presentation, leaving read status untouched. */
  cancel(): void;
}

/**
 * Schedules the read-through claim for a visibly presented Timeline tail. Each
 * observation restarts the dwell, so only a tail that stops changing while the
 * reader is present is ever presented to the Host.
 */
export function createTailPresentation(
  present: () => void,
  timers: {
    schedule(callback: () => void, delay: number): number;
    cancel(handle: number): void;
  } = {
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: handle => window.clearTimeout(handle),
  },
  dwellMs: number = tailPresentationDwellMs,
): TailPresentation {
  let pending: number | undefined;
  const cancel = () => {
    if (pending !== undefined) timers.cancel(pending);
    pending = undefined;
  };
  return {
    cancel,
    observe({ tailVisible, documentVisible }) {
      cancel();
      if (!tailVisible || !documentVisible) return;
      pending = timers.schedule(() => {
        pending = undefined;
        present();
      }, dwellMs);
    },
  };
}

export interface VisibleTimelineAnchor {
  element: HTMLElement;
  top: number;
}

export function captureVisibleTimelineAnchor(viewport: HTMLElement): VisibleTimelineAnchor | undefined {
  const viewportBounds = viewport.getBoundingClientRect();
  const entries = viewport.querySelectorAll<HTMLElement>("[data-entry-id]");
  const element = [...entries].find(entry => {
    const bounds = entry.getBoundingClientRect();
    return bounds.bottom > viewportBounds.top && bounds.top < viewportBounds.bottom;
  });
  if (!element) return undefined;
  return { element, top: element.getBoundingClientRect().top };
}

export function restoreVisibleTimelineAnchor(
  viewport: HTMLElement,
  anchor: VisibleTimelineAnchor | undefined,
): void {
  if (!anchor) return;
  viewport.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
}

export function scrollTimelineToTail(viewport: HTMLElement, reducedMotion: boolean): () => void {
  const start = viewport.scrollTop;
  const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const distance = target - start;
  if (reducedMotion || Math.abs(distance) < 1) {
    viewport.scrollTop = target;
    return () => {};
  }

  let animationFrame = 0;
  let cancelled = false;
  const startedAt = performance.now();
  const step = (now: number) => {
    if (cancelled) return;
    const progress = Math.min(1, (now - startedAt) / timelineJumpDurationMs);
    viewport.scrollTop = start + distance * easeOutCubic(progress);
    if (progress < 1) animationFrame = requestAnimationFrame(step);
  };
  animationFrame = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(animationFrame);
  };
}

export function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}
