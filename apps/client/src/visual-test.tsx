import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createClientStore, type InteractionFact, type SessionFact, type TimelineFact } from "./client-store.js";
import "./style.css";

/**
 * Fixture recency is offset to the middle of its rendered bucket so relative
 * copy stays stable for the duration of a visual run.
 */
const minutesAgo = (minutes: number) => Date.now() - Math.round((minutes + 0.5) * 60_000);

// Covers all four discovery row states: working, blocked, review, and idle.
const sessions: SessionFact[] = [
  { sessionId: "reconnect", name: "Reconnect receipt race", projectId: "Pidex", metadataRevision: 3, timelineRevision: 12, attention: "working", activity: { detail: "exec_command: command receipts · reconnect continuity" }, readState: { readStatus: "unread", readStateRevision: 2, readThroughTimelineRevision: 7 } },
  { sessionId: "release", name: "Release pipeline review", projectId: "Pidex", metadataRevision: 2, timelineRevision: 9, attention: "needs-response", activity: { detail: "Choose the deployment target" }, readState: { readStatus: "unread", readStateRevision: 1, readThroughTimelineRevision: 4 } },
  { sessionId: "corruption", name: "Index corruption diagnosis", projectId: "Pidex", metadataRevision: 1, timelineRevision: 5, attention: "quiet", activity: { at: minutesAgo(18) }, readState: { readStatus: "unread", readStateRevision: 1, readThroughTimelineRevision: 2 } },
  { sessionId: "cache", name: "PWA cache boundaries", projectId: "Pidex", metadataRevision: 1, timelineRevision: 3, attention: "quiet", activity: { at: minutesAgo(64) } },
  { sessionId: "api", name: "Explore API response shape", metadataRevision: 1, timelineRevision: 2, attention: "quiet", activity: { at: minutesAgo(1500) } },
];

const timeline: TimelineFact[] = [
  { entryId: "prompt-17", kind: "prompt", runId: "run-17", order: 1, finalized: true, text: "Make reconnect command receipts impossible to replay twice." },
  { entryId: "work-17", kind: "assistant", runId: "run-17", order: 2, finalized: true, text: "Traced command identity through reconnection and the authoritative receipt lookup." },
  { entryId: "tool-17", kind: "tool", runId: "run-17", order: 3, finalized: true, text: "Checked the durable receipt path\npackages/host/src/store.ts" },
  { entryId: "response-17", kind: "response", runId: "run-17", order: 4, finalized: true, text: "Receipt replay is now blocked at the authority boundary. The original command identity survives transport loss, and the Client reconciles that receipt before another Host mutation becomes available." },
  { entryId: "prompt-18", kind: "prompt", runId: "run-18", order: 5, finalized: true, text: "Run the focused receipt and reconnect checks." },
  { entryId: "work-18", kind: "assistant", runId: "run-18", order: 6, finalized: true, text: "Reviewing the command receipt invariants." },
  { entryId: "tool-read-18", kind: "tool", runId: "run-18", order: 7, finalized: true, text: "Read test/command-receipts.product.test.ts" },
  { entryId: "tool-test-18", kind: "tool", runId: "run-18", order: 8, finalized: false, text: "exec_command: command receipts · reconnect continuity" },
];

const interaction: InteractionFact = {
  interactionId: "deploy-target", sessionId: "reconnect", runId: "run-18", workerGeneration: 2,
  correlationId: "deploy", kind: "select", payload: { message: "Choose the deployment target", options: ["Staging", "Production"] },
  provenance: "release-tools", state: "open", revision: 1, createdAt: 1, deadlineAt: 9999999999999,
  terminalCause: null, respondedAt: null, applicationProven: null,
};

const store = createClientStore({
  host: { async readSession() { throw new Error("visual fixture does not navigate"); } },
  drafts: { async read() { return ""; }, async write() {} },
  routing: { replace() {} },
});

declare global {
  interface Window {
    __pidexVisualStore?: typeof store;
  }
}

window.__pidexVisualStore = store;

const scenario = new URLSearchParams(location.search).get("scenario");
const showInteraction = scenario === "interaction";
store.setState({
  projects: [{ projectId: "Pidex", name: "Pidex" }],
  sessions: Object.fromEntries(sessions.map(session => [session.sessionId, session])),
  sessionOrder: sessions.map(session => session.sessionId),
  selectedSessionId: "reconnect",
  expandedProjectIds: ["Pidex"],
  timelines: { reconnect: timeline },
  runs: { reconnect: [{ runId: "run-18", sessionId: "reconnect", sessionOrder: 2, prompt: timeline[4]!.text, state: "executing", workerGeneration: "worker-2" }] },
  interactions: { reconnect: showInteraction ? [interaction] : [] },
  drafts: { reconnect: "" },
  isSessionCurrent: true,
});

if (scenario === "new-session") store.setState({
  selectedSessionId: undefined,
  newSession: {
    projectId: "Pidex",
    workspaceId: "C:\\git\\Pidex",
    draft: "",
    location: { kind: "local" },
    worktreeDiscovery: { phase: "idle" },
    progress: { phase: "editing" },
  },
});

createRoot(document.getElementById("root")!).render(<App clientStore={store}/>);
