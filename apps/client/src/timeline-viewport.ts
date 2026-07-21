export type TimelineTailPosition = "unobserved" | "following" | "detached";

export const initialTailPosition: TimelineTailPosition = "unobserved";

export function tailPositionFromVisibility(visible: boolean): TimelineTailPosition {
  return visible ? "following" : "detached";
}

export function shouldFollowTimelineTail(position: TimelineTailPosition): boolean {
  return position === "following";
}

export function shouldShowJumpToLatest(position: TimelineTailPosition): boolean {
  return position === "detached";
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
