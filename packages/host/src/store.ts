import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { HostAdapters, PiTimelineEvent } from "../../adapters/src/index.js";
import {
  acceptedRunSchema,
  completedRunSchema,
  hostChangeSchema,
  projectSummarySchema,
  runRecordSchema,
  sessionSummarySchema,
  terminalRunSchema,
  timelineEntrySchema,
  workspaceSummarySchema,
  type AcceptedRun,
  type CompletedRun,
  type HostChange,
  type HostStatus,
  type ProjectSummary,
  type SessionSummary,
  type TerminalRun,
  type TimelineChange,
  type TimelineEntry,
  type TimelineWindow,
  type WorkspaceSummary,
} from "../../protocol/src/status.js";
import { RunArtifactStore } from "./run-artifacts.js";

export type { RunRecord, TimelineEntry } from "../../protocol/src/status.js";

const CREATE_AUTHORITY_SCHEMA = `
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=FULL;
  CREATE TABLE IF NOT EXISTS host (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    host_id TEXT NOT NULL,
    epoch TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    readiness TEXT NOT NULL,
    committed_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    public_key_jwk TEXT NOT NULL,
    paired_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revoked_devices (
    device_id TEXT PRIMARY KEY,
    paired_at INTEGER NOT NULL,
    revoked_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(project_id),
    workspace_id TEXT REFERENCES workspaces(workspace_id),
    name TEXT NOT NULL DEFAULT 'Untitled Session',
    retention TEXT NOT NULL CHECK(retention='available'),
    residency TEXT NOT NULL CHECK(residency IN ('sleeping','resident')),
    metadata_revision INTEGER NOT NULL,
    timeline_revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS command_receipts (
    device_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    envelope_digest TEXT NOT NULL,
    outcome_json TEXT NOT NULL,
    commit_cursor TEXT NOT NULL,
    committed_at INTEGER NOT NULL,
    PRIMARY KEY(device_id, command_id)
  );
  CREATE TABLE IF NOT EXISTS synchronization_changes (
    sequence INTEGER PRIMARY KEY,
    payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    session_order INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('accepted','completed','failed','cancelled','interrupted')),
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE(session_id, session_order)
  );
  CREATE TABLE IF NOT EXISTS timeline_entries (
    entry_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    entry_order INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    checkpoint TEXT,
    blob_id TEXT,
    created_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    finalized INTEGER NOT NULL DEFAULT 1,
    tool_call_id TEXT,
    UNIQUE(session_id, entry_order)
  );
`;

export interface SubmitCommand {
  commandId: string;
  sessionId: string;
  prompt: string;
  requiredCapability: "run.submit";
}

const submitOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("accepted"),
    run: acceptedRunSchema,
    cursor: z.string(),
    digest: z.string(),
  }),
  z.object({
    kind: z.literal("rejected"),
    error: z.literal("unknown-session"),
    cursor: z.string(),
    digest: z.string(),
  }),
]);
const nextRunOrderSchema = z.object({ nextOrder: z.number() });
const acceptedRunReferenceSchema = z.object({ runId: z.string() });
const timelineEntryReferenceSchema = z.object({ entryId: z.string() });
const timelineOrderSchema = z.object({ value: z.number() });
const TIMELINE_WINDOW_SIZE = 100;

const TIMELINE_ENTRY_PROJECTION = `
  entry_id AS entryId, run_id AS runId,
  entry_order AS 'order', kind, text, blob_id AS blobId,
  revision, finalized != 0 AS finalized,
  tool_call_id AS toolCallId
`;

export type SubmitOutcome = z.infer<typeof submitOutcomeSchema>;

export type SubmitResult =
  | SubmitOutcome
  | { kind: "replayed"; outcome: SubmitOutcome; digest: string }
  | { kind: "command-id-conflict" };

export interface RenameCommand {
  commandId: string;
  sessionId: string;
  name: string;
  requiredCapability: "session.rename";
  observedMetadataRevision: number;
}

const renameOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("accepted"),
    session: sessionSummarySchema,
    cursor: z.string(),
    digest: z.string(),
  }),
  z.object({
    kind: z.literal("rejected"),
    error: z.enum(["stale-precondition", "unknown-session"]),
    currentMetadataRevision: z.number().optional(),
    cursor: z.string(),
    digest: z.string(),
  }),
]);

export type RenameOutcome = z.infer<typeof renameOutcomeSchema>;

export type RenameResult =
  | RenameOutcome
  | { kind: "replayed"; outcome: RenameOutcome; digest: string }
  | { kind: "command-id-conflict" };

export interface InitialCatalog {
  projects?: ProjectSummary[];
  workspaces?: WorkspaceSummary[];
}

type CursorBasis =
  | { compatible: true; sequence: number }
  | {
      compatible: false;
      reason: "host-mismatch" | "epoch-mismatch" | "history-unavailable";
    };

interface DecodedCursor {
  hostId: string;
  epoch: string;
  sequence: number;
}

interface SynchronizationChange {
  cursor: string;
  change: HostChange;
}

export class AuthorityStore {
  readonly #db: DatabaseSync;
  readonly #runArtifacts: RunArtifactStore;

  constructor(path: string, adapters: HostAdapters, catalog: InitialCatalog = {}) {
    const dataDir = dirname(path);
    mkdirSync(dataDir, { recursive: true });
    this.#runArtifacts = new RunArtifactStore(dataDir);
    this.#db = new DatabaseSync(path);
    this.#db.exec(CREATE_AUTHORITY_SCHEMA);
    const sessionColumns = this.#db.prepare("PRAGMA table_info(sessions)").all();
    if (!sessionColumns.some(column => column.name === "name")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled Session'",
      );
    }
    const timelineColumns = this.#db
      .prepare("PRAGMA table_info(timeline_entries)")
      .all();
    if (!timelineColumns.some(column => column.name === "blob_id")) {
      this.#db.exec("ALTER TABLE timeline_entries ADD COLUMN blob_id TEXT");
    }
    if (!timelineColumns.some(column => column.name === "revision")) {
      this.#db.exec(
        "ALTER TABLE timeline_entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
      );
    }
    if (!timelineColumns.some(column => column.name === "finalized")) {
      this.#db.exec(
        "ALTER TABLE timeline_entries ADD COLUMN finalized INTEGER NOT NULL DEFAULT 1",
      );
    }
    if (!timelineColumns.some(column => column.name === "tool_call_id")) {
      this.#db.exec(
        "ALTER TABLE timeline_entries ADD COLUMN tool_call_id TEXT",
      );
    }

    const existingHost = this.#db
      .prepare("SELECT 1 FROM host WHERE singleton=1")
      .get();
    if (!existingHost) {
      adapters.storage.beforeCommit();
      this.#db
        .prepare("INSERT INTO host VALUES (1, ?, ?, 1, 'ready', ?)")
        .run(`host_${randomUUID()}`, randomUUID(), adapters.clock.now());
    }
    for (const project of catalog.projects ?? []) {
      this.#db
        .prepare("INSERT OR IGNORE INTO projects VALUES (?, ?)")
        .run(project.projectId, project.name);
    }
    for (const workspace of catalog.workspaces ?? []) {
      this.#db
        .prepare("INSERT OR IGNORE INTO workspaces VALUES (?, ?, ?)")
        .run(workspace.workspaceId, workspace.projectId, workspace.name);
    }
  }

  projection(): {
    projects: ProjectSummary[];
    workspaces: WorkspaceSummary[];
    sessions: SessionSummary[];
  } {
    const projects = this.#db
      .prepare(
        "SELECT project_id AS projectId, name FROM projects ORDER BY name",
      )
      .all();
    const workspaces = this.#db
      .prepare(
        `SELECT workspace_id AS workspaceId, project_id AS projectId, name
         FROM workspaces ORDER BY name`,
      )
      .all();
    const sessions = this.#db
      .prepare(
        `SELECT session_id AS sessionId, name, project_id AS projectId,
                workspace_id AS workspaceId, retention, residency,
                metadata_revision AS metadataRevision,
                timeline_revision AS timelineRevision
         FROM sessions ORDER BY created_at`,
      )
      .all();

    return {
      projects: projectSummarySchema.array().parse(projects),
      workspaces: workspaceSummarySchema.array().parse(workspaces),
      sessions: sessionSummarySchema.array().parse(sessions),
    };
  }

  createSession(
    projectId: string | null,
    workspaceId: string | null,
    now: number,
  ): { session: SessionSummary; cursor: string } {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const projectExists = projectId
        ? this.#db
            .prepare("SELECT 1 FROM projects WHERE project_id = ?")
            .get(projectId)
        : true;
      if (!projectExists) {
        throw new Error("unknown-project");
      }

      if (workspaceId) {
        const workspace = this.#db
          .prepare(
            "SELECT project_id FROM workspaces WHERE workspace_id = ?",
          )
          .get(workspaceId);
        if (!workspace) {
          throw new Error("unknown-workspace");
        }
        if (!projectId || workspace.project_id !== projectId) {
          throw new Error("workspace-project-mismatch");
        }
      }

      const session: SessionSummary = {
        sessionId: `session_${randomUUID()}`,
        name: "Untitled Session",
        projectId,
        workspaceId,
        retention: "available",
        residency: "sleeping",
        metadataRevision: 1,
        timelineRevision: 1,
      };
      this.#db
        .prepare(
          `INSERT INTO sessions
           (session_id, project_id, workspace_id, name, retention, residency,
            metadata_revision, timeline_revision, created_at)
           VALUES (?, ?, ?, 'Untitled Session', 'available', 'sleeping', 1, 1, ?)`,
        )
        .run(session.sessionId, projectId, workspaceId, now);
      this.#db
        .prepare(
          `UPDATE host SET sequence = sequence + 1, committed_at = ?
           WHERE singleton = 1`,
        )
        .run(now);
      const cursor = this.recordSynchronizationChange({
        type: "session.created",
        session,
      });
      this.#db.exec("COMMIT");
      return { session, cursor };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  renameSession(
    deviceId: string,
    command: RenameCommand,
    now: number,
  ): RenameResult {
    const digest = renameCommandDigest(command);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = this.#db
        .prepare(
          `SELECT envelope_digest, outcome_json FROM command_receipts
           WHERE device_id = ? AND command_id = ?`,
        )
        .get(deviceId, command.commandId);
      if (receipt) {
        this.#db.exec("COMMIT");
        if (receipt.envelope_digest !== digest) {
          return { kind: "command-id-conflict" };
        }
        const outcome = renameOutcomeSchema.parse(
          JSON.parse(String(receipt.outcome_json)),
        );
        return { kind: "replayed", outcome, digest };
      }

      const row = this.#db
        .prepare(
          "SELECT metadata_revision FROM sessions WHERE session_id = ?",
        )
        .get(command.sessionId);
      let outcome: RenameOutcome;
      if (!row || typeof row.metadata_revision !== "number") {
        outcome = {
          kind: "rejected",
          error: "unknown-session",
          cursor: this.status("").synchronization.cursor,
          digest,
        };
      } else if (row.metadata_revision !== command.observedMetadataRevision) {
        outcome = {
          kind: "rejected",
          error: "stale-precondition",
          currentMetadataRevision: row.metadata_revision,
          cursor: this.status("").synchronization.cursor,
          digest,
        };
      } else {
        this.#db
          .prepare(
            `UPDATE sessions SET name = ?, metadata_revision = metadata_revision + 1
             WHERE session_id = ?`,
          )
          .run(command.name, command.sessionId);
        this.#db
          .prepare(
            `UPDATE host SET sequence = sequence + 1, committed_at = ?
             WHERE singleton = 1`,
          )
          .run(now);
        const session = this.loadSession(command.sessionId);
        const cursor = this.recordSynchronizationChange({
          type: "session.renamed",
          session,
        });
        outcome = {
          kind: "accepted",
          session,
          cursor,
          digest,
        };
      }
      this.#db
        .prepare(
          `INSERT INTO command_receipts
           (device_id, command_id, envelope_digest, outcome_json,
            commit_cursor, committed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          deviceId,
          command.commandId,
          digest,
          JSON.stringify(outcome),
          outcome.cursor,
          now,
        );
      this.#db.exec("COMMIT");
      return outcome;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  submitRun(
    deviceId: string,
    command: SubmitCommand,
    now: number,
  ): SubmitResult {
    const digest = submitCommandDigest(command);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = this.#db
        .prepare(
          `SELECT envelope_digest, outcome_json FROM command_receipts
           WHERE device_id = ? AND command_id = ?`,
        )
        .get(deviceId, command.commandId);
      if (receipt) {
        if (receipt.envelope_digest !== digest) {
          this.#db.exec("COMMIT");
          return { kind: "command-id-conflict" };
        }

        const outcome = submitOutcomeSchema.parse(
          JSON.parse(String(receipt.outcome_json)),
        );
        this.#db.exec("COMMIT");
        return { kind: "replayed", outcome, digest };
      }

      const sessionExists = this.#db
        .prepare("SELECT 1 FROM sessions WHERE session_id = ?")
        .get(command.sessionId);
      const cursor = this.status("").synchronization.cursor;
      let outcome: SubmitOutcome;
      if (!sessionExists) {
        outcome = { kind: "rejected", error: "unknown-session", cursor, digest };
      } else {
        const orderRow = this.#db
          .prepare(
            `SELECT COALESCE(MAX(session_order), 0) + 1 AS nextOrder
             FROM runs WHERE session_id = ?`,
          )
          .get(command.sessionId);
        const sessionOrder = nextRunOrderSchema.parse(orderRow).nextOrder;
        const run: AcceptedRun = {
          runId: `run_${randomUUID()}`,
          sessionId: command.sessionId,
          sessionOrder,
          prompt: command.prompt,
          state: "accepted",
        };
        this.#db
          .prepare(
            `INSERT INTO runs
             (run_id, session_id, session_order, prompt, state, created_at,
              completed_at)
             VALUES (?, ?, ?, ?, 'accepted', ?, NULL)`,
          )
          .run(run.runId, run.sessionId, run.sessionOrder, run.prompt, now);
        this.#db
          .prepare(
            `INSERT INTO timeline_entries
             (entry_id, session_id, run_id, entry_order, kind, text,
              checkpoint, created_at)
             VALUES (?, ?, ?, ?, 'prompt', ?, NULL, ?)`,
          )
          .run(
            `entry_${randomUUID()}`,
            run.sessionId,
            run.runId,
            this.nextTimelineOrder(run.sessionId),
            run.prompt,
            now,
          );
        this.#db
          .prepare(
            `UPDATE sessions
             SET residency = 'resident',
                 timeline_revision = timeline_revision + 1
             WHERE session_id = ?`,
          )
          .run(run.sessionId);
        outcome = { kind: "accepted", run, cursor, digest };
      }

      this.#db
        .prepare(
          `INSERT INTO command_receipts
           (device_id, command_id, envelope_digest, outcome_json,
            commit_cursor, committed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          deviceId,
          command.commandId,
          digest,
          JSON.stringify(outcome),
          cursor,
          now,
        );
      this.#db.exec("COMMIT");
      return outcome;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  completeRun(
    runId: string,
    text: string,
    checkpoint: string,
    now: number,
  ): { run: CompletedRun; timeline: TimelineEntry[] } {
    this.stageCompletionEvidence(runId, text, checkpoint);
    const settlement = this.settleRun(
      runId,
      "completed",
      text,
      checkpoint,
      now,
    );
    this.#runArtifacts.removeCompletionEvidence(runId);
    return {
      run: completedRunSchema.parse(settlement.run),
      timeline: settlement.timeline,
    };
  }

  stageCompletionEvidence(runId: string, text: string, checkpoint: string): void {
    this.#runArtifacts.stageCompletionEvidence(runId, text, checkpoint);
  }

  reconcileAcceptedRuns(now: number): void {
    for (const { runId } of this.acceptedRuns()) {
      try {
        const evidence = this.#runArtifacts.readCompletionEvidence(runId);
        if (evidence) {
          this.settleRun(
            runId,
            "completed",
            evidence.text,
            evidence.checkpoint,
            now,
          );
          this.#runArtifacts.removeCompletionEvidence(runId);
          continue;
        }
      } catch {
        // Corrupt or incomplete proof cannot establish normal completion.
      }
      this.settleRun(
        runId,
        "interrupted",
        "Execution was interrupted; normal completion could not be proved.",
        null,
        now,
      );
    }
  }

  /** Publish immutable bytes first, then atomically reference them and settle once. */
  settleRun(
    runId: string,
    outcome: TerminalRun["state"],
    text: string,
    checkpoint: string | null,
    now: number,
  ): { run: TerminalRun; timeline: TimelineEntry[] } {
    const blobId = this.#runArtifacts.publishBlob(Buffer.from(text));
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#db
        .prepare(
          `SELECT run_id AS runId, session_id AS sessionId,
                  session_order AS sessionOrder, prompt, state
           FROM runs WHERE run_id = ?`,
        )
        .get(runId);
      if (!row) {
        throw new Error("run-not-accepted");
      }

      const acceptedRun = runRecordSchema.parse(row);
      if (acceptedRun.state !== "accepted") {
        throw new Error("run-not-accepted");
      }

      this.#db
        .prepare(
          `INSERT INTO timeline_entries
           (entry_id, session_id, run_id, entry_order, kind, text,
            checkpoint, blob_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `entry_${randomUUID()}`,
          acceptedRun.sessionId,
          runId,
          this.nextTimelineOrder(acceptedRun.sessionId),
          outcome === "completed" ? "response" : "outcome",
          text,
          checkpoint,
          blobId,
          now,
        );
      this.#db
        .prepare(
          `UPDATE runs SET state = ?, completed_at = ?
           WHERE run_id = ? AND state = 'accepted'`,
        )
        .run(outcome, now, runId);
      this.#db
        .prepare(
          `UPDATE sessions
           SET timeline_revision = timeline_revision + 1
           WHERE session_id = ?`,
        )
        .run(acceptedRun.sessionId);
      this.#db.prepare(
        "UPDATE host SET sequence = sequence + 1, committed_at = ? WHERE singleton = 1",
      ).run(now);
      const terminalRun = terminalRunSchema.parse({
        ...acceptedRun,
        state: outcome,
      });
      const settlement = {
        run: terminalRun,
        timeline: this.timeline(acceptedRun.sessionId),
      };
      this.#db.exec("COMMIT");
      return settlement;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  timeline(sessionId: string): TimelineEntry[] {
    const rows = this.#db
      .prepare(
        `SELECT ${TIMELINE_ENTRY_PROJECTION}
         FROM timeline_entries
         WHERE session_id = ?
         ORDER BY entry_order`,
      )
      .all(sessionId);
    return timelineEntrySchema.array().parse(rows);
  }

  timelineWindow(sessionId: string): TimelineWindow {
    const rows = this.#db.prepare(
      `SELECT ${TIMELINE_ENTRY_PROJECTION} FROM timeline_entries
       WHERE session_id = ? ORDER BY entry_order DESC LIMIT ?`,
    ).all(sessionId, TIMELINE_WINDOW_SIZE).reverse();
    const entries = timelineEntrySchema.array().parse(rows);
    const firstOrder = entries[0]?.order;
    return {
      entries,
      olderCursor: firstOrder && this.hasFinalizedBefore(sessionId, firstOrder)
        ? this.encodeTimelineCursor(sessionId, firstOrder)
        : null,
    };
  }

  timelinePage(sessionId: string, cursor: string, requestedLimit: number): TimelineWindow | null {
    const decoded = this.decodeTimelineCursor(cursor);
    if (!decoded || decoded.sessionId !== sessionId) return null;
    const limit = Math.max(1, Math.min(200, requestedLimit));
    const rows = this.#db.prepare(
      `SELECT ${TIMELINE_ENTRY_PROJECTION} FROM timeline_entries
       WHERE session_id = ? AND finalized = 1 AND entry_order < ?
       ORDER BY entry_order DESC LIMIT ?`,
    ).all(sessionId, decoded.before, limit).reverse();
    const entries = timelineEntrySchema.array().parse(rows);
    const firstOrder = entries[0]?.order;
    return {
      entries,
      olderCursor: firstOrder && this.hasFinalizedBefore(sessionId, firstOrder)
        ? this.encodeTimelineCursor(sessionId, firstOrder)
        : null,
    };
  }

  runs(sessionId: string) {
    return runRecordSchema.array().parse(this.#db.prepare(
      `SELECT run_id AS runId, session_id AS sessionId, session_order AS sessionOrder,
              prompt, state FROM runs WHERE session_id = ? AND state = 'accepted'
       ORDER BY session_order`,
    ).all(sessionId));
  }

  readReferencedBlob(blobId: string): Buffer | null {
    const reference = this.#db.prepare(
      "SELECT 1 FROM timeline_entries WHERE blob_id = ? LIMIT 1",
    ).get(blobId);
    if (!reference) return null;
    return this.#runArtifacts.readBlob(blobId);
  }

  private hasFinalizedBefore(sessionId: string, before: number): boolean {
    return Boolean(this.#db.prepare(
      `SELECT 1 FROM timeline_entries WHERE session_id = ? AND finalized = 1
       AND entry_order < ? LIMIT 1`,
    ).get(sessionId, before));
  }

  private encodeTimelineCursor(sessionId: string, before: number): string {
    const status = this.status("");
    return Buffer.from(JSON.stringify({ hostId: status.hostId, epoch: status.synchronization.epoch,
      sessionId, before })).toString("base64url");
  }

  private decodeTimelineCursor(cursor: string): { sessionId: string; before: number } | null {
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>;
      const status = this.status("");
      if (value.hostId !== status.hostId || value.epoch !== status.synchronization.epoch ||
          typeof value.sessionId !== "string" || !Number.isSafeInteger(value.before)) return null;
      return { sessionId: value.sessionId, before: value.before as number };
    } catch { return null; }
  }

  /** Applies one runtime fact and returns the exact revisioned projection change. */
  applyTimelineEvent(
    sessionId: string,
    runId: string,
    event: PiTimelineEvent,
    now: number,
  ): TimelineChange {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const session = this.loadSession(sessionId);
      let entryId: string;

      switch (event.type) {
        case "assistant.delta":
          entryId = this.appendAssistantDelta(
            sessionId,
            runId,
            event.text,
            now,
          );
          break;
        case "tool.started":
          entryId = this.startToolEntry(
            sessionId,
            runId,
            event.toolCallId,
            event.name,
            now,
          );
          break;
        case "tool.completed":
          entryId = this.completeToolEntry(
            sessionId,
            runId,
            event.toolCallId,
            event.name,
            event.text,
            now,
          );
          break;
      }

      const change = this.advanceTimelineRevision(
        sessionId,
        session.timelineRevision,
        entryId,
      );
      this.#db.exec("COMMIT");
      return change;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  finalizeAssistant(
    sessionId: string,
    runId: string,
  ): TimelineChange | undefined {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.findOpenAssistantEntry(sessionId, runId);
      if (!row) {
        this.#db.exec("COMMIT");
        return undefined;
      }

      const session = this.loadSession(sessionId);
      this.#db.prepare(
        `UPDATE timeline_entries
         SET revision = revision + 1, finalized = 1
         WHERE entry_id = ?`,
      ).run(row.entryId);
      const change = this.advanceTimelineRevision(
        sessionId,
        session.timelineRevision,
        row.entryId,
      );
      this.#db.exec("COMMIT");
      return change;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  acceptedRuns(): Array<{ runId: string }> {
    const rows = this.#db
      .prepare("SELECT run_id AS runId FROM runs WHERE state = 'accepted'")
      .all();
    return acceptedRunReferenceSchema.array().parse(rows);
  }

  private appendAssistantDelta(
    sessionId: string,
    runId: string,
    text: string,
    now: number,
  ): string {
    const openAssistant = this.findOpenAssistantEntry(sessionId, runId);
    if (openAssistant) {
      this.#db
        .prepare(
          `UPDATE timeline_entries
           SET text = text || ?, revision = revision + 1
           WHERE entry_id = ?`,
        )
        .run(text, openAssistant.entryId);
      return openAssistant.entryId;
    }

    return this.insertLiveTimelineEntry({
      sessionId,
      runId,
      kind: "assistant",
      text,
      finalized: false,
      toolCallId: null,
      now,
    });
  }

  private startToolEntry(
    sessionId: string,
    runId: string,
    toolCallId: string,
    name: string,
    now: number,
  ): string {
    return this.insertLiveTimelineEntry({
      sessionId,
      runId,
      kind: "tool",
      text: name,
      finalized: false,
      toolCallId,
      now,
    });
  }

  private completeToolEntry(
    sessionId: string,
    runId: string,
    toolCallId: string,
    name: string,
    text: string,
    now: number,
  ): string {
    const openTool = timelineEntryReferenceSchema.optional().parse(
      this.#db
        .prepare(
          `SELECT entry_id AS entryId FROM timeline_entries
           WHERE session_id = ? AND run_id = ? AND tool_call_id = ?
             AND finalized = 0`,
        )
        .get(sessionId, runId, toolCallId),
    );
    const completedText = `${name}: ${text}`;
    if (openTool) {
      this.#db
        .prepare(
          `UPDATE timeline_entries
           SET text = ?, revision = revision + 1, finalized = 1
           WHERE entry_id = ?`,
        )
        .run(completedText, openTool.entryId);
      return openTool.entryId;
    }

    return this.insertLiveTimelineEntry({
      sessionId,
      runId,
      kind: "tool",
      text: completedText,
      finalized: true,
      toolCallId,
      now,
    });
  }

  private findOpenAssistantEntry(
    sessionId: string,
    runId: string,
  ): { entryId: string } | undefined {
    const row = this.#db
      .prepare(
        `SELECT entry_id AS entryId FROM timeline_entries
         WHERE session_id = ? AND run_id = ? AND kind = 'assistant'
           AND finalized = 0
         ORDER BY entry_order DESC LIMIT 1`,
      )
      .get(sessionId, runId);
    return timelineEntryReferenceSchema.optional().parse(row);
  }

  private insertLiveTimelineEntry(entry: {
    sessionId: string;
    runId: string;
    kind: "assistant" | "tool";
    text: string;
    finalized: boolean;
    toolCallId: string | null;
    now: number;
  }): string {
    const entryId = `entry_${randomUUID()}`;
    this.#db
      .prepare(
        `INSERT INTO timeline_entries
         (entry_id, session_id, run_id, entry_order, kind, text, checkpoint,
          blob_id, created_at, revision, finalized, tool_call_id)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?)`,
      )
      .run(
        entryId,
        entry.sessionId,
        entry.runId,
        this.nextTimelineOrder(entry.sessionId),
        entry.kind,
        entry.text,
        entry.now,
        Number(entry.finalized),
        entry.toolCallId,
      );
    return entryId;
  }

  private advanceTimelineRevision(
    sessionId: string,
    baseRevision: number,
    entryId: string,
  ): TimelineChange {
    this.#db
      .prepare(
        `UPDATE sessions
         SET timeline_revision = timeline_revision + 1
         WHERE session_id = ?`,
      )
      .run(sessionId);
    return {
      baseRevision,
      revision: baseRevision + 1,
      entry: this.loadTimelineEntry(entryId),
    };
  }

  private loadTimelineEntry(entryId: string): TimelineEntry {
    const row = this.#db
      .prepare(
        `SELECT ${TIMELINE_ENTRY_PROJECTION}
         FROM timeline_entries
         WHERE entry_id = ?`,
      )
      .get(entryId);
    return timelineEntrySchema.parse(row);
  }

  private nextTimelineOrder(sessionId: string): number {
    const row = this.#db
      .prepare(
        `SELECT COALESCE(MAX(entry_order), 0) + 1 AS value
         FROM timeline_entries WHERE session_id = ?`,
      )
      .get(sessionId);
    return timelineOrderSchema.parse(row).value;
  }

  private loadSession(sessionId: string): SessionSummary {
    const row = this.#db
      .prepare(
        `SELECT session_id AS sessionId, name, project_id AS projectId,
                workspace_id AS workspaceId, retention, residency,
                metadata_revision AS metadataRevision,
                timeline_revision AS timelineRevision
         FROM sessions WHERE session_id = ?`,
      )
      .get(sessionId);
    return sessionSummarySchema.parse(row);
  }

  status(
    releaseId: string,
    warnings: HostStatus["warnings"] = [],
  ): HostStatus {
    const row = this.#db
      .prepare("SELECT host_id, epoch, sequence FROM host WHERE singleton=1")
      .get();

    if (
      !row ||
      typeof row.host_id !== "string" ||
      typeof row.epoch !== "string" ||
      typeof row.sequence !== "number"
    ) {
      throw new Error("The Host authority record is missing or invalid");
    }

    return {
      hostId: row.host_id,
      releaseId,
      readiness: "ready",
      warnings,
      synchronization: {
        epoch: row.epoch,
        sequence: row.sequence,
        cursor: encodeCursor(row.host_id, row.epoch, row.sequence),
      },
    };
  }

  cursorBasis(cursor: string): CursorBasis {
    const decoded = decodeCursor(cursor);
    const status = this.status("");
    if (!decoded || decoded.hostId !== status.hostId) {
      return { compatible: false, reason: "host-mismatch" };
    }
    if (decoded.epoch !== status.synchronization.epoch) {
      return { compatible: false, reason: "epoch-mismatch" };
    }
    if (decoded.sequence > status.synchronization.sequence) {
      return { compatible: false, reason: "history-unavailable" };
    }

    const earliest = this.#db
      .prepare(
        "SELECT MIN(sequence) AS sequence FROM synchronization_changes",
      )
      .get();
    const earliestRetainedSequence =
      earliest && typeof earliest.sequence === "number"
        ? earliest.sequence
        : undefined;
    const hasMissingChanges =
      decoded.sequence < status.synchronization.sequence &&
      earliestRetainedSequence !== undefined &&
      decoded.sequence < earliestRetainedSequence - 1;
    if (hasMissingChanges) {
      return { compatible: false, reason: "history-unavailable" };
    }

    return { compatible: true, sequence: decoded.sequence };
  }

  changesAfter(sequence: number): SynchronizationChange[] {
    const status = this.status("");
    const rows = this.#db
      .prepare(
        `SELECT sequence, payload_json FROM synchronization_changes
         WHERE sequence > ? ORDER BY sequence`,
      )
      .all(sequence);

    return rows.map(row => ({
      cursor: encodeCursor(
        status.hostId,
        status.synchronization.epoch,
        Number(row.sequence),
      ),
      change: hostChangeSchema.parse(JSON.parse(String(row.payload_json))),
    }));
  }

  rotateSynchronizationEpoch(now: number): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          `UPDATE host SET epoch = ?, sequence = sequence + 1, committed_at = ?
           WHERE singleton = 1`,
        )
        .run(randomUUID(), now);
      this.#db.prepare("DELETE FROM synchronization_changes").run();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  private recordSynchronizationChange(change: HostChange): string {
    const synchronization = this.status("").synchronization;
    this.#db
      .prepare("INSERT INTO synchronization_changes VALUES (?, ?)")
      .run(synchronization.sequence, JSON.stringify(change));
    return synchronization.cursor;
  }

  addDevice(deviceId: string, publicKeyJwk: string, pairedAt: number): void {
    this.#db
      .prepare(
        "INSERT INTO devices (device_id, public_key_jwk, paired_at) VALUES (?, ?, ?)",
      )
      .run(deviceId, publicKeyJwk, pairedAt);
  }

  devicePublicKey(deviceId: string): string | undefined {
    const row = this.#db
      .prepare("SELECT public_key_jwk FROM devices WHERE device_id = ?")
      .get(deviceId);
    return row && typeof row.public_key_jwk === "string"
      ? row.public_key_jwk
      : undefined;
  }

  revokeDevice(deviceId: string, revokedAt: number): boolean {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#db
        .prepare("SELECT paired_at FROM devices WHERE device_id = ?")
        .get(deviceId);
      if (!row || typeof row.paired_at !== "number") {
        this.#db.exec("ROLLBACK");
        return false;
      }

      this.#db
        .prepare(
          "INSERT INTO revoked_devices (device_id, paired_at, revoked_at) VALUES (?, ?, ?)",
        )
        .run(deviceId, row.paired_at, revokedAt);
      this.#db.prepare("DELETE FROM devices WHERE device_id = ?").run(deviceId);
      this.#db.exec("COMMIT");
      return true;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }
}

function encodeCursor(hostId: string, epoch: string, sequence: number): string {
  return `sync_${Buffer.from(JSON.stringify({ hostId, epoch, sequence })).toString("base64url")}`;
}

function decodeCursor(cursor: string): DecodedCursor | undefined {
  if (!cursor.startsWith("sync_")) {
    return undefined;
  }

  try {
    const json = Buffer.from(cursor.slice(5), "base64url").toString();
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const sequence = record.sequence;
    if (
      typeof record.hostId !== "string" ||
      typeof record.epoch !== "string" ||
      typeof sequence !== "number" ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1
    ) {
      return undefined;
    }

    return {
      hostId: record.hostId,
      epoch: record.epoch,
      sequence,
    };
  } catch {
    return undefined;
  }
}

function renameCommandDigest(command: RenameCommand): string {
  const envelope = JSON.stringify({
    type: "session.rename",
    commandId: command.commandId,
    sessionId: command.sessionId,
    name: command.name,
    requiredCapability: command.requiredCapability,
    observedMetadataRevision: command.observedMetadataRevision,
  });
  return createHash("sha256").update(envelope).digest("hex");
}

function submitCommandDigest(command: SubmitCommand): string {
  return createHash("sha256")
    .update(JSON.stringify(command))
    .digest("hex");
}
