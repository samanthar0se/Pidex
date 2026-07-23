import type { TimelineFact } from "./client-store.js";

export type TimelineTurnPhase = "complete" | "responding" | "working";

export type TimelineTurnSegment =
  | { kind: "activity"; entries: readonly TimelineFact[]; active: boolean }
  | { kind: "entry"; entry: TimelineFact };

export interface TimelineTurnPresentation {
  kind: "turn";
  turnId: string;
  runId: string | null;
  phase: TimelineTurnPhase;
  entryIds: readonly string[];
  segments: readonly TimelineTurnSegment[];
}

export interface TimelineStandalonePresentation {
  kind: "standalone";
  entry: TimelineFact;
}

export type TimelinePresentationItem = TimelineTurnPresentation | TimelineStandalonePresentation;

export function projectTimelineTurns(
  entries: readonly TimelineFact[],
  executingRunIds: ReadonlySet<string> = new Set(),
): TimelinePresentationItem[] {
  const items: TimelinePresentationItem[] = [];
  let turnEntries: TimelineFact[] = [];

  const flushTurn = () => {
    if (turnEntries.length === 0) return;
    items.push(projectTurn(turnEntries, executingRunIds));
    turnEntries = [];
  };

  for (const entry of entries) {
    if (entry.kind === "prompt") {
      flushTurn();
      turnEntries.push(entry);
      continue;
    }

    const currentRunId = turnEntries.find(item => item.runId != null)?.runId ?? null;
    const changesKnownRun = currentRunId != null && entry.runId != null && entry.runId !== currentRunId;
    if (changesKnownRun) flushTurn();

    if (turnEntries.length === 0 && !belongsToTurn(entry)) {
      items.push({ kind: "standalone", entry });
      continue;
    }

    turnEntries.push(entry);
  }

  flushTurn();
  return items;
}

export function getActivitySummary(entry: TimelineFact): string {
  return getActivityText(entry).summary;
}

export function getActivityDetail(entry: TimelineFact): string | null {
  return getActivityText(entry).detail;
}

export function getToolCallPreview(entry: TimelineFact): string | null {
  if (entry.kind !== "tool") return null;
  const toolName = getActivitySummary(entry).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

  if (/^(read|read_file|read_text)$/.test(toolName)) return "Reading a file…";
  if (/^(web_run|web_search|search_web)$/.test(toolName)) return "Searching the web…";
  if (/^(search|search_files|grep|glob|rg)$/.test(toolName)) return "Searching files…";
  if (/^(exec|exec_command|shell|terminal)$/.test(toolName)) return "Executing a command…";
  if (/^(write_stdin)$/.test(toolName)) return "Continuing a command…";
  if (/^(apply_patch|edit|edit_file|write_file)$/.test(toolName)) return "Editing files…";
  if (/^(view_image)$/.test(toolName)) return "Viewing an image…";
  if (/^(find_roots|observe_ui|search_ui|expand_ui|inspect_ui)$/.test(toolName)) return "Inspecting the interface…";
  if (/^(act_ui)$/.test(toolName)) return "Interacting with the interface…";
  if (/^(launch_browser|navigate_browser|evaluate_browser)$/.test(toolName)) return "Using the browser…";
  if (/^(workflow|workflow_control)$/.test(toolName)) return "Running a workflow…";
  return "Using a tool…";
}

function getActivityText(entry: TimelineFact): { summary: string; detail: string | null } {
  const lines = entry.text.split(/\r?\n/);
  const firstContentIndex = lines.findIndex(line => line.trim().length > 0);
  const fallbackSummary = entry.kind === "tool" ? "Tool activity" : "Agent activity";
  if (firstContentIndex < 0) return { summary: fallbackSummary, detail: null };

  const firstLine = lines[firstContentIndex]!.trim();
  const remainingLines = lines.slice(firstContentIndex + 1);
  const toolSeparator = entry.kind === "tool"
    ? firstLine.indexOf(": ") >= 0
      ? firstLine.indexOf(": ")
      : firstLine.endsWith(":") ? firstLine.length - 1 : -1
    : -1;
  const summary = toolSeparator > 0 ? firstLine.slice(0, toolSeparator).trim() : firstLine;
  const inlineToolDetail = toolSeparator > 0 ? firstLine.slice(toolSeparator + 1).trimStart() : "";
  const detail = [inlineToolDetail, ...remainingLines].join("\n").trim();
  return { summary: summary || fallbackSummary, detail: detail.length > 0 ? detail : null };
}

function projectTurn(
  entries: readonly TimelineFact[],
  executingRunIds: ReadonlySet<string>,
): TimelineTurnPresentation {
  const activityEntries = entries.filter(isActivity);
  const responseEntries = entries.filter(entry => entry.kind === "response");
  const runId = entries.find(entry => entry.runId != null)?.runId ?? null;
  const responseStarted = responseEntries.length > 0;
  const associatedRunExecuting = runId != null && executingRunIds.has(runId);
  const activityActive = !responseStarted
    && (associatedRunExecuting || activityEntries.some(entry => entry.finalized === false));
  const phase: TimelineTurnPhase = responseEntries.some(entry => entry.finalized === false)
    ? "responding"
    : activityActive || associatedRunExecuting
      ? "working"
      : "complete";
  const segments: TimelineTurnSegment[] = [];
  let consecutiveActivity: TimelineFact[] = [];
  const flushActivity = () => {
    if (consecutiveActivity.length === 0) return;
    segments.push({ kind: "activity", entries: consecutiveActivity, active: activityActive });
    consecutiveActivity = [];
  };

  for (const entry of entries) {
    if (isActivity(entry)) {
      consecutiveActivity.push(entry);
      continue;
    }
    flushActivity();
    segments.push({ kind: "entry", entry });
  }
  flushActivity();

  return {
    kind: "turn",
    turnId: `turn:${entries[0]!.entryId}`,
    runId,
    phase,
    entryIds: entries.map(entry => entry.entryId),
    segments,
  };
}

function isActivity(entry: TimelineFact): boolean {
  return entry.kind === "assistant" || entry.kind === "tool";
}

function belongsToTurn(entry: TimelineFact): boolean {
  return isActivity(entry) || entry.kind === "response";
}
