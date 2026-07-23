import assert from "node:assert/strict";
import test from "node:test";
import {
  captureVisibleTimelineAnchor,
  easeOutCubic,
  initialTailPosition,
  restoreVisibleTimelineAnchor,
  scrollTimelineToTail,
  shouldFollowTimelineTail,
  shouldShowJumpToLatest,
  tailPositionFromDistance,
  tailPositionFromVisibility,
  timelineFollowThresholdPx,
} from "../apps/client/src/timeline-viewport.js";
import { getTimelineEntryPresentation } from "../apps/client/src/timeline-entry-presentation.js";
import {
  getActivityDetail,
  getActivitySummary,
  getToolCallPreview,
  projectTimelineTurns,
} from "../apps/client/src/timeline-turn-presentation.js";

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

test("tail following starts unobserved and uses a narrow near-tail threshold", () => {
  assert.equal(shouldFollowTimelineTail(initialTailPosition), false);
  assert.equal(shouldShowJumpToLatest(initialTailPosition), false);

  const following = tailPositionFromVisibility(true);
  assert.equal(shouldFollowTimelineTail(following), true);
  assert.equal(shouldShowJumpToLatest(following), false);

  const detached = tailPositionFromVisibility(false);
  assert.equal(shouldFollowTimelineTail(detached), false);
  assert.equal(shouldShowJumpToLatest(detached), true);

  assert.equal(tailPositionFromDistance(timelineFollowThresholdPx), "following");
  assert.equal(tailPositionFromDistance(timelineFollowThresholdPx + 1), "detached");
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(0.5), 0.875);
  assert.equal(easeOutCubic(1), 1);

  const viewport = { scrollTop: 100, scrollHeight: 500, clientHeight: 200 } as HTMLElement;
  scrollTimelineToTail(viewport, true);
  assert.equal(viewport.scrollTop, 300);
});

test("historical Interactions remain ordinary non-interactive Timeline facts", () => {
  assert.deepEqual(getTimelineEntryPresentation("interaction"), {
    layout: "fact",
    label: "interaction",
    abnormal: false,
  });
});

test("turn projection resolves prompt, grouped work, and response without losing entry order", () => {
  const projection = projectTimelineTurns([
    { entryId: "prompt", kind: "prompt", runId: "run-1", order: 1, finalized: true, text: "Fix it" },
    { entryId: "reasoning", kind: "assistant", runId: "run-1", order: 2, finalized: true, text: "Tracing the receipt" },
    { entryId: "tool", kind: "tool", runId: "run-1", order: 3, finalized: false, text: "Running tests" },
    { entryId: "response", kind: "response", runId: "run-1", order: 4, finalized: false, text: "The fix is ready." },
  ]);

  assert.equal(projection.length, 1);
  const turn = projection[0];
  assert.equal(turn?.kind, "turn");
  if (turn?.kind !== "turn") return;
  assert.equal(turn.phase, "responding");
  assert.deepEqual(turn.entryIds, ["prompt", "reasoning", "tool", "response"]);
  assert.deepEqual(turn.segments.map(segment => segment.kind), ["entry", "activity", "entry"]);
  const activity = turn.segments[1];
  assert.equal(activity?.kind, "activity");
  if (activity?.kind === "activity") {
    assert.deepEqual(activity.entries.map(entry => entry.entryId), ["reasoning", "tool"]);
    assert.equal(activity.active, false);
  }
});

test("turn projection does not move activity across an intervening authoritative fact", () => {
  const projection = projectTimelineTurns([
    { entryId: "prompt", kind: "prompt", runId: "run-1", order: 1, finalized: true, text: "Fix it" },
    { entryId: "reasoning", kind: "assistant", runId: "run-1", order: 2, finalized: true, text: "Checking" },
    { entryId: "outcome", kind: "outcome", runId: "run-1", order: 3, finalized: true, text: "Tool failed" },
    { entryId: "tool", kind: "tool", runId: "run-1", order: 4, finalized: true, text: "Retrying" },
    { entryId: "response", kind: "response", runId: "run-1", order: 5, finalized: true, text: "Recovered" },
  ]);

  const turn = projection[0];
  assert.equal(turn?.kind, "turn");
  if (turn?.kind !== "turn") return;
  assert.deepEqual(turn.segments.map(segment => segment.kind), [
    "entry",
    "activity",
    "entry",
    "activity",
    "entry",
  ]);
  assert.deepEqual(turn.segments.flatMap(segment => segment.kind === "activity"
    ? segment.entries.map(entry => entry.entryId)
    : [segment.entry.entryId]), ["prompt", "reasoning", "outcome", "tool", "response"]);
});

test("turn projection never merges different known Runs and leaves leading facts standalone", () => {
  const projection = projectTimelineTurns([
    { entryId: "restored", kind: "lifecycle", order: 1, finalized: true, text: "Session restored" },
    { entryId: "work-1", kind: "assistant", runId: "run-1", order: 2, finalized: true, text: "First Run" },
    { entryId: "work-2", kind: "tool", runId: "run-2", order: 3, finalized: false, text: "Second Run" },
  ], new Set(["run-2"]));

  assert.deepEqual(projection.map(item => item.kind), ["standalone", "turn", "turn"]);
  assert.equal(projection[1]?.kind === "turn" && projection[1].runId, "run-1");
  assert.equal(projection[2]?.kind === "turn" && projection[2].runId, "run-2");
  assert.equal(projection[2]?.kind === "turn" && projection[2].phase, "working");
});

test("activity summaries stay concise while preserving multiline raw detail", () => {
  const entry = {
    entryId: "tool",
    kind: "tool" as const,
    finalized: true,
    text: "Read packages/host/src/store.ts\nFound the receipt lookup\nVerified the revision guard",
  };
  assert.equal(getActivitySummary(entry), "Read packages/host/src/store.ts");
  assert.equal(getActivityDetail(entry), "Found the receipt lookup\nVerified the revision guard");
});

test("completed tool output stays out of the collapsed activity summary", () => {
  const entry = {
    entryId: "tool-raw",
    kind: "tool" as const,
    toolCallId: "call-raw",
    finalized: true,
    text: "read: FULL_RAW_OUTPUT_SHOULD_NOT_APPEAR\nsecond raw line",
  };

  assert.equal(getActivitySummary(entry), "read");
  assert.equal(getActivityDetail(entry), "FULL_RAW_OUTPUT_SHOULD_NOT_APPEAR\nsecond raw line");
});

test("tool call previews expose semantic actions without arguments or output", () => {
  const tool = (text: string) => ({ entryId: text, kind: "tool" as const, finalized: false, text });

  assert.equal(getToolCallPreview(tool("read_text: C:/secret/file.txt")), "Reading a file…");
  assert.equal(getToolCallPreview(tool("web_run: private search results")), "Searching the web…");
  assert.equal(getToolCallPreview(tool("exec_command: npm test\nprivate command output")), "Executing a command…");
  assert.equal(getToolCallPreview(tool("unknown_private_tool: private output")), "Using a tool…");
  assert.equal(getToolCallPreview({ entryId: "assistant", kind: "assistant", finalized: false, text: "Working" }), null);
});
