import assert from "node:assert/strict";
import test from "node:test";
import {
  captureVisibleTimelineAnchor,
  initialTailPosition,
  restoreVisibleTimelineAnchor,
  shouldFollowTimelineTail,
  shouldShowJumpToLatest,
  tailPositionFromVisibility,
} from "../apps/client/src/timeline-viewport.js";
import { getTimelineEntryPresentation } from "../apps/client/src/timeline-entry-presentation.js";

test("automatic paging preserves the first visible entry instead of an offscreen entry", () => {
  let visibleTop = 25;
  const offscreenEntry = {
    getBoundingClientRect: () => ({ top: -80, bottom: -20 }),
  } as HTMLElement;
  const visibleEntry = {
    getBoundingClientRect: () => ({ top: visibleTop, bottom: 75 }),
  } as HTMLElement;
  const viewport = {
    scrollTop: 100,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    querySelectorAll: () => [offscreenEntry, visibleEntry],
  } as unknown as HTMLElement;

  const anchor = captureVisibleTimelineAnchor(viewport);
  visibleTop = 55;
  restoreVisibleTimelineAnchor(viewport, anchor);

  assert.equal(anchor?.element, visibleEntry);
  assert.equal(viewport.scrollTop, 130);
});

test("tail following starts unobserved and begins only after the tail is visible", () => {
  assert.equal(shouldFollowTimelineTail(initialTailPosition), false);
  assert.equal(shouldShowJumpToLatest(initialTailPosition), false);

  const following = tailPositionFromVisibility(true);
  assert.equal(shouldFollowTimelineTail(following), true);
  assert.equal(shouldShowJumpToLatest(following), false);

  const detached = tailPositionFromVisibility(false);
  assert.equal(shouldFollowTimelineTail(detached), false);
  assert.equal(shouldShowJumpToLatest(detached), true);
});

test("historical Interactions remain ordinary non-interactive Timeline facts", () => {
  assert.deepEqual(getTimelineEntryPresentation("interaction"), {
    layout: "fact",
    label: "interaction",
    abnormal: false,
  });
});
