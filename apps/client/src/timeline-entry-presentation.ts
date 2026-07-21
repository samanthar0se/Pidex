import type { TimelineKind } from "./client-store.js";

export interface TimelineEntryPresentation {
  layout: "work" | "fact";
  label?: string;
  abnormal: boolean;
}

const presentations: Readonly<Record<TimelineKind, TimelineEntryPresentation>> = {
  assistant: { layout: "work", label: "Work", abnormal: false },
  tool: { layout: "work", label: "Tool activity", abnormal: false },
  prompt: { layout: "fact", label: "prompt", abnormal: false },
  response: { layout: "fact", abnormal: false },
  outcome: { layout: "fact", label: "outcome", abnormal: true },
  lifecycle: { layout: "fact", label: "lifecycle", abnormal: true },
  interaction: { layout: "fact", label: "interaction", abnormal: false },
};

export function getTimelineEntryPresentation(kind: TimelineKind): TimelineEntryPresentation {
  return presentations[kind];
}
