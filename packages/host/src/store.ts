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
  interactionSchema,
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
  type Interaction,
  type ProjectSummary,
  type RunRecord,
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
    availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN ('available','archived')),
    residency TEXT NOT NULL CHECK(residency IN ('sleeping','resident')),
    metadata_revision INTEGER NOT NULL,
    timeline_revision INTEGER NOT NULL,
    parent_session_id TEXT REFERENCES sessions(session_id),
    fork_point_entry_id TEXT,
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
    payload_json TEXT NOT NULL,
    committed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS storage_orphans (
    object_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('blob')),
    first_proved_at INTEGER NOT NULL,
    proof_generation TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('quarantined'))
  );
  CREATE TABLE IF NOT EXISTS retained_object_references (
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    object_id TEXT NOT NULL,
    protected INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(owner_kind, owner_id, object_id)
  );
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    session_order INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    state TEXT NOT NULL CHECK(
      state IN (
        'queued', 'executing', 'cancelling', 'held', 'completed',
        'failed', 'cancelled', 'interrupted'
      )
    ),
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
  CREATE TABLE IF NOT EXISTS interactions (
    interaction_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    run_id TEXT REFERENCES runs(run_id),
    worker_generation INTEGER NOT NULL,
    correlation_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('select','confirm','input','editor')),
    payload_json TEXT NOT NULL,
    provenance TEXT,
    state TEXT NOT NULL CHECK(state IN ('open','resolving','responded','dismissed','expired','withdrawn')),
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deadline_at INTEGER,
    terminal_cause TEXT,
    responded_at INTEGER,
    responding_device_label TEXT,
    application_proven INTEGER,
    UNIQUE(session_id, worker_generation, correlation_id)
  );
  CREATE TABLE IF NOT EXISTS steering (
    command_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    worker_generation TEXT NOT NULL,
    text TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('accepted','applied','unapplied')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(device_id, command_id)
  );
`;

export interface SubmitCommand {
  commandId: string;
  sessionId: string;
  prompt: string;
  requiredCapability: "run.submit" | "run.follow-up";
}

export interface SteerCommand {
  commandId: string;
  sessionId: string;
  runId: string;
  workerGeneration: string;
  observedTimelineRevision: number;
  text: string;
}

export interface StopCommand {
  commandId: string;
  sessionId: string;
  runId: string;
  workerGeneration: string;
  observedState: "executing";
  observedTimelineRevision: number;
}

export type StopResult =
  | {
      kind: "accepted" | "replayed";
      run: RunRecord;
      entry: TimelineEntry;
      withdrawn: Interaction[];
      cursor: string;
    }
  | {
      kind: "rejected";
      error: "stale-execution" | "command-id-conflict";
      cursor: string;
    };

export type SteerResult =
  | { kind: "accepted" | "replayed"; entry: TimelineEntry; cursor: string }
  | { kind: "rejected"; error: "stale-execution"; cursor: string };

const submitOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("accepted"),
    run: acceptedRunSchema,
    cursor: z.string(),
    digest: z.string(),
  }),
  z.object({
    kind: z.literal("rejected"),
    error: z.enum(["unknown-session", "session-archived", "session-busy", "no-executing-run"]),
    cursor: z.string(),
    digest: z.string(),
  }),
]);
const nextRunOrderSchema = z.object({ nextOrder: z.number() });
const activeRunReferenceSchema = z.object({ runId: z.string() });
const authorityIntegrityCheckSchema = z.object({
  integrity_check: z.literal("ok"),
});
const timelineEntryReferenceSchema = z.object({ entryId: z.string() });
const timelineOrderSchema = z.object({ value: z.number() });
const timelineRevisionSchema = z.object({ timelineRevision: z.number() });
const sessionResidencyRowSchema = sessionSummarySchema.pick({ residency: true });
const sessionAvailabilitySchema = z.enum(["available", "archived"]);
const sessionRowSchema = sessionSummarySchema.extend({
  availability: sessionAvailabilitySchema,
});
const forkPointSchema = z.object({
  entryId: z.string(),
  checkpoint: z.string(),
  entryOrder: z.number(),
  finalized: z.coerce.boolean(),
  kind: z.string(),
});
const sessionAvailabilityStateSchema = sessionRowSchema.pick({
  availability: true,
  metadataRevision: true,
});
const sessionAvailabilityOnlySchema = sessionRowSchema.pick({
  availability: true,
});
const checkpointRowSchema = z.object({ checkpoint: z.string() });
const stopReceiptOutcomeSchema = z.object({
  runId: z.string(),
  entryId: z.string(),
  cursor: z.string(),
});
const TIMELINE_WINDOW_SIZE = 100;
const MAX_TIMELINE_PAGE_SIZE = 200;
const timelineCursorSchema = z.object({
  hostId: z.string(),
  epoch: z.string(),
  sessionId: z.string(),
  before: z.number().refine(Number.isSafeInteger),
});
type TimelineCursor = z.infer<typeof timelineCursorSchema>;

const TIMELINE_ENTRY_PROJECTION = `
  entry_id AS entryId, run_id AS runId,
  entry_order AS 'order', kind, text, blob_id AS blobId,
  revision, finalized != 0 AS finalized,
  tool_call_id AS toolCallId
`;
const INTERACTION_PROJECTION = `
  interaction_id AS interactionId, session_id AS sessionId,
  run_id AS runId, worker_generation AS workerGeneration,
  correlation_id AS correlationId, kind, payload_json AS payloadJson,
  provenance, state, revision, created_at AS createdAt,
  deadline_at AS deadlineAt, terminal_cause AS terminalCause,
  responded_at AS respondedAt, responding_device_label AS respondingDeviceLabel,
  application_proven AS applicationProven
`;

type NewInteraction = Omit<
  Interaction,
  | "interactionId"
  | "state"
  | "revision"
  | "terminalCause"
  | "respondedAt"
  | "respondingDeviceLabel"
  | "applicationProven"
>;

type ActiveInteractionState = Extract<
  Interaction["state"],
  "open" | "resolving"
>;
type TerminalInteractionState = Exclude<
  Interaction["state"],
  ActiveInteractionState
>;

interface CreatedInteraction {
  interaction: Interaction;
  timelineChange: TimelineChange;
}

const RUN_RECORD_PROJECTION = `
  run_id AS runId, session_id AS sessionId,
  session_order AS sessionOrder, prompt, state
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

export interface SessionAvailabilityCommand {
  commandId: string;
  sessionId: string;
  observedMetadataRevision: number;
}

type SessionAvailability = z.infer<typeof sessionAvailabilitySchema>;

const sessionAvailabilityOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("accepted"),
    session: sessionSummarySchema,
    cursor: z.string(),
  }),
  z.object({
    kind: z.literal("rejected"),
    error: z.enum([
      "unknown-session",
      "stale-precondition",
      "already-archived",
      "not-archived",
      "session-not-quiescent",
    ]),
    cursor: z.string(),
  }),
]);

type SessionAvailabilityOutcome = z.infer<
  typeof sessionAvailabilityOutcomeSchema
>;
type SessionAvailabilityError = Extract<
  SessionAvailabilityOutcome,
  { kind: "rejected" }
>["error"];
type SessionAvailabilityResult =
  | SessionAvailabilityOutcome
  | {
      kind: "replayed";
      session: SessionSummary;
      cursor: string;
    }
  | {
      kind: "replayed";
      error: SessionAvailabilityError;
      cursor: string;
    }
  | {
      kind: "rejected";
      error: "command-id-conflict";
      cursor: string;
    };

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

export interface MaintenanceResult {
  receiptsCompacted: number;
  changesCompacted: number;
  quarantined: string[];
  deleted: string[];
  restored: string[];
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
    if (!sessionColumns.some(column => column.name === "availability")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN availability TEXT NOT NULL DEFAULT 'available'",
      );
    }
    if (!sessionColumns.some(column => column.name === "parent_session_id")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(session_id)",
      );
    }
    if (!sessionColumns.some(column => column.name === "fork_point_entry_id")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN fork_point_entry_id TEXT",
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
    const changeColumns = this.#db.prepare("PRAGMA table_info(synchronization_changes)").all();
    if (!changeColumns.some(column => column.name === "committed_at")) {
      this.#db.exec("ALTER TABLE synchronization_changes ADD COLUMN committed_at INTEGER");
    }
    const runsTable = this.#db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'",
      )
      .get();
    const runSql = String(runsTable?.sql ?? "");
    if (runSql.includes("'accepted'")) {
      this.#db.exec(`
        ALTER TABLE runs RENAME TO runs_legacy;
        CREATE TABLE runs (
          run_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(session_id),
          session_order INTEGER NOT NULL,
          prompt TEXT NOT NULL,
          state TEXT NOT NULL CHECK(
            state IN (
              'queued', 'executing', 'cancelling', 'held', 'completed',
              'failed', 'cancelled', 'interrupted'
            )
          ),
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          UNIQUE(session_id, session_order)
        );
        INSERT INTO runs
          SELECT run_id, session_id, session_order, prompt,
                 CASE state WHEN 'accepted' THEN 'executing' ELSE state END,
                 created_at, completed_at
          FROM runs_legacy;
        DROP TABLE runs_legacy;
      `);
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
    archivedSessions: SessionSummary[];
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
    const sessionRows = this.#db
      .prepare(
        `SELECT session_id AS sessionId, name, project_id AS projectId,
                workspace_id AS workspaceId, retention, availability, residency,
                metadata_revision AS metadataRevision,
                timeline_revision AS timelineRevision,
                parent_session_id AS parentSessionId,
                fork_point_entry_id AS forkPointEntryId
         FROM sessions ORDER BY created_at`,
      )
      .all();
    const sessions: SessionSummary[] = [];
    const archivedSessions: SessionSummary[] = [];
    for (const row of sessionRowSchema.array().parse(sessionRows)) {
      const { availability, ...session } = row;
      if (availability === "archived") {
        archivedSessions.push({ ...session, availability });
      } else {
        sessions.push(session);
      }
    }

    return {
      projects: projectSummarySchema.array().parse(projects),
      workspaces: workspaceSummarySchema.array().parse(workspaces),
      sessions,
      archivedSessions,
    };
  }

  createSession(
    projectId: string | null,
    workspaceId: string | null,
    now: number,
  ): { session: SessionSummary; cursor: string } {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.validateSessionScope(projectId, workspaceId);

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

  /** Atomically creates an inert child and copies only finalized durable history. */
  forkSession(
    parentSessionId: string,
    forkPointEntryId: string,
    projectId: string | null | undefined,
    workspaceId: string | null | undefined,
    childSessionId: string,
    validatedCheckpoint: string,
    now: number,
  ): { session: SessionSummary; cursor: string } {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const parent = this.loadSession(parentSessionId);
      const point = forkPointSchema.optional().parse(
        this.#db
          .prepare(
            `SELECT entry_id AS entryId, checkpoint,
                    entry_order AS entryOrder,
                    finalized != 0 AS finalized, kind
             FROM timeline_entries
             WHERE session_id = ? AND entry_id = ?`,
          )
          .get(parentSessionId, forkPointEntryId),
      );
      if (
        !point ||
        !point.finalized ||
        point.kind !== "response" ||
        point.checkpoint !== validatedCheckpoint
      ) {
        throw new Error("invalid-fork-point");
      }

      const targetProjectId =
        projectId === undefined ? parent.projectId : projectId;
      const targetWorkspaceId =
        workspaceId === undefined ? parent.workspaceId : workspaceId;
      this.validateSessionScope(targetProjectId, targetWorkspaceId);
      this.#db
        .prepare(
          `INSERT INTO sessions
           (session_id, project_id, workspace_id, name, retention, availability,
            residency, metadata_revision, timeline_revision, created_at,
            parent_session_id, fork_point_entry_id)
           VALUES (?, ?, ?, 'Untitled Session', 'available', 'available',
                   'sleeping', 1, 1, ?, ?, ?)`,
        )
        .run(
          childSessionId,
          targetProjectId,
          targetWorkspaceId,
          now,
          parentSessionId,
          forkPointEntryId,
        );

      const runRows = this.#db
        .prepare(
          `SELECT run_id AS parentRunId, session_order AS sessionOrder,
                  prompt, state, created_at AS createdAt,
                  completed_at AS completedAt
           FROM runs
           WHERE session_id = ?
             AND state IN ('completed','failed','cancelled','interrupted')
             AND run_id IN (
               SELECT run_id FROM timeline_entries
               WHERE session_id = ? AND entry_order <= ?
             )`,
        )
        .all(parentSessionId, parentSessionId, point.entryOrder);
      const childRunIdsByParentId = new Map<string, string>();
      const insertRun = this.#db.prepare(
        `INSERT INTO runs
         (run_id, session_id, session_order, prompt, state, created_at,
          completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of runRows) {
        const childRunId = `run_${randomUUID()}`;
        childRunIdsByParentId.set(String(row.parentRunId), childRunId);
        insertRun.run(
          childRunId,
          childSessionId,
          row.sessionOrder,
          row.prompt,
          row.state,
          row.createdAt,
          row.completedAt,
        );
      }

      const entries = this.#db
        .prepare(
          `SELECT run_id AS parentRunId, entry_order AS entryOrder, kind, text,
                  checkpoint, blob_id AS blobId, created_at AS createdAt,
                  revision, finalized, tool_call_id AS toolCallId
           FROM timeline_entries
           WHERE session_id = ? AND entry_order <= ?
           ORDER BY entry_order`,
        )
        .all(parentSessionId, point.entryOrder);
      const insertEntry = this.#db.prepare(
        `INSERT INTO timeline_entries
         (entry_id, session_id, run_id, entry_order, kind, text, checkpoint,
          blob_id, created_at, revision, finalized, tool_call_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of entries) {
        const childRunId = childRunIdsByParentId.get(
          String(row.parentRunId),
        );
        if (!childRunId || !Boolean(row.finalized)) {
          throw new Error("invalid-fork-point");
        }
        insertEntry.run(
          `entry_${randomUUID()}`,
          childSessionId,
          childRunId,
          row.entryOrder,
          row.kind,
          row.text,
          row.checkpoint,
          row.blobId,
          row.createdAt,
          row.revision,
          row.finalized,
          row.toolCallId,
        );
      }

      this.#db
        .prepare(
          "UPDATE sessions SET timeline_revision = ? WHERE session_id = ?",
        )
        .run(entries.length + 1, childSessionId);
      this.#db
        .prepare(
          `UPDATE host SET sequence = sequence + 1, committed_at = ?
           WHERE singleton = 1`,
        )
        .run(now);
      const session = this.loadSession(childSessionId);
      const cursor = this.recordSynchronizationChange({
        type: "session.forked",
        session,
      });
      this.#db.exec("COMMIT");
      return { session, cursor };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  changeSessionAvailability(
    deviceId: string,
    command: SessionAvailabilityCommand,
    availability: SessionAvailability,
    now: number,
  ): SessionAvailabilityResult {
    const digest = createHash("sha256")
      .update(JSON.stringify({ ...command, availability }))
      .digest("hex");
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
          return {
            kind: "rejected",
            error: "command-id-conflict",
            cursor: this.status("").synchronization.cursor,
          };
        }
        const outcome = sessionAvailabilityOutcomeSchema.parse(
          JSON.parse(String(receipt.outcome_json)),
        );
        return { ...outcome, kind: "replayed" };
      }

      const row = this.#db
        .prepare(
          `SELECT metadata_revision AS metadataRevision, availability
           FROM sessions WHERE session_id = ?`,
        )
        .get(command.sessionId);
      const sessionState = sessionAvailabilityStateSchema
        .optional()
        .parse(row);
      const cursor = this.status("").synchronization.cursor;
      let result: SessionAvailabilityOutcome;
      if (!sessionState) {
        result = { kind: "rejected", error: "unknown-session", cursor };
      } else if (
        sessionState.metadataRevision !== command.observedMetadataRevision
      ) {
        result = { kind: "rejected", error: "stale-precondition", cursor };
      } else if (sessionState.availability === availability) {
        const error = availability === "archived"
          ? "already-archived"
          : "not-archived";
        result = { kind: "rejected", error, cursor };
      } else if (
        availability === "archived" &&
        this.sessionHasActiveWork(command.sessionId)
      ) {
        result = {
          kind: "rejected",
          error: "session-not-quiescent",
          cursor,
        };
      } else {
        this.#db
          .prepare(
            `UPDATE sessions
             SET availability = ?, residency = 'sleeping',
                 metadata_revision = metadata_revision + 1
             WHERE session_id = ?`,
          )
          .run(availability, command.sessionId);
        this.#db
          .prepare(
            `UPDATE host SET sequence = sequence + 1, committed_at = ?
             WHERE singleton = 1`,
          )
          .run(now);
        const session = this.loadSession(command.sessionId);
        const changeType = availability === "archived"
          ? "session.archived"
          : "session.restored";
        const nextCursor = this.recordSynchronizationChange({
          type: changeType,
          session,
        });
        result = { kind: "accepted", session, cursor: nextCursor };
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
          JSON.stringify(result),
          result.cursor,
          now,
        );
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Commit residency only while the durable Session is fully quiescent. */
  setSessionSleeping(
    sessionId: string,
    now: number,
  ): { session: SessionSummary; cursor: string } {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const session = this.#db
        .prepare("SELECT residency FROM sessions WHERE session_id = ?")
        .get(sessionId);
      const residencyRow = sessionResidencyRowSchema.optional().parse(session);
      if (!residencyRow) {
        throw new Error("unknown-session");
      }

      if (residencyRow.residency === "sleeping") {
        const current = this.loadSession(sessionId);
        this.#db.exec("COMMIT");
        return {
          session: current,
          cursor: this.status("internal").synchronization.cursor,
        };
      }

      if (this.sessionHasActiveWork(sessionId)) {
        throw new Error("session-not-quiescent");
      }

      this.#db.prepare(
        `UPDATE sessions SET residency = 'sleeping',
         metadata_revision = metadata_revision + 1 WHERE session_id = ?`,
      ).run(sessionId);
      this.#db.prepare(
        "UPDATE host SET sequence = sequence + 1, committed_at = ? WHERE singleton = 1",
      ).run(now);
      const sleepingSession = this.loadSession(sessionId);
      const cursor = this.recordSynchronizationChange({
        type: "session.residency-changed",
        session: sleepingSession,
      });
      this.#db.exec("COMMIT");
      return { session: sleepingSession, cursor };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  latestCheckpoint(sessionId: string): string | undefined {
    const row = this.#db
      .prepare(
        `SELECT checkpoint FROM timeline_entries WHERE session_id = ?
         AND checkpoint IS NOT NULL ORDER BY entry_order DESC LIMIT 1`,
      )
      .get(sessionId);
    return checkpointRowSchema.optional().parse(row)?.checkpoint;
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

      const sessionState = sessionAvailabilityOnlySchema
        .optional()
        .parse(
          this.#db
            .prepare(
              "SELECT availability FROM sessions WHERE session_id = ?",
            )
            .get(command.sessionId),
        );
      const cursor = this.status("").synchronization.cursor;
      let outcome: SubmitOutcome;
      if (!sessionState) {
        outcome = { kind: "rejected", error: "unknown-session", cursor, digest };
      } else if (sessionState.availability === "archived") {
        outcome = {
          kind: "rejected",
          error: "session-archived",
          cursor,
          digest,
        };
      } else {
        const activeRun = this.#db
          .prepare(
            `SELECT 1 FROM runs
             WHERE session_id = ? AND state IN ('queued','executing','held')
             LIMIT 1`,
          )
          .get(command.sessionId);
        const isFollowUp = command.requiredCapability === "run.follow-up";
        let rejectionError: "no-executing-run" | "session-busy" | undefined;
        if (isFollowUp && !activeRun) {
          rejectionError = "no-executing-run";
        } else if (!isFollowUp && activeRun) {
          rejectionError = "session-busy";
        }

        if (rejectionError) {
          outcome = {
            kind: "rejected",
            error: rejectionError,
            cursor,
            digest,
          };
          this.insertRunReceipt(
            deviceId,
            command.commandId,
            digest,
            outcome,
            now,
          );
          this.#db.exec("COMMIT");
          return outcome;
        }
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
          state: isFollowUp ? "queued" : "executing",
        };
        this.#db
          .prepare(
            `INSERT INTO runs
             (run_id, session_id, session_order, prompt, state, created_at,
              completed_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            run.runId,
            run.sessionId,
            run.sessionOrder,
            run.prompt,
            run.state,
            now,
          );
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

      this.insertRunReceipt(
        deviceId,
        command.commandId,
        digest,
        outcome,
        now,
      );
      this.#db.exec("COMMIT");
      return outcome;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Atomically records steering before the Host attempts worker delivery. */
  acceptSteering(
    deviceId: string,
    command: SteerCommand,
    activeWorkerGeneration: string | undefined,
    now: number,
  ): SteerResult {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const priorSteering = timelineEntryReferenceSchema.optional().parse(
        this.#db
          .prepare(
            `SELECT entry_id AS entryId FROM steering
             WHERE device_id = ? AND command_id = ?`,
          )
          .get(deviceId, command.commandId),
      );
      if (priorSteering) {
        const entry = this.loadTimelineEntry(priorSteering.entryId);
        this.#db.exec("COMMIT");
        return {
          kind: "replayed",
          entry,
          cursor: this.status("").synchronization.cursor,
        };
      }

      const run = this.#db
        .prepare(
          `SELECT ${RUN_RECORD_PROJECTION} FROM runs
           WHERE run_id = ? AND session_id = ?`,
        )
        .get(command.runId, command.sessionId);
      const session = timelineRevisionSchema.optional().parse(
        this.#db
          .prepare(
            `SELECT timeline_revision AS timelineRevision
             FROM sessions WHERE session_id = ?`,
          )
          .get(command.sessionId),
      );
      const cursor = this.status("").synchronization.cursor;
      const runIsExecuting =
        run !== undefined && runRecordSchema.parse(run).state === "executing";
      const targetsActiveExecution =
        runIsExecuting &&
        activeWorkerGeneration === command.workerGeneration &&
        session?.timelineRevision === command.observedTimelineRevision;
      if (!targetsActiveExecution) {
        this.#db.exec("COMMIT");
        return { kind: "rejected", error: "stale-execution", cursor };
      }

      const entryId = `entry_${randomUUID()}`;
      this.#db
        .prepare(
          `INSERT INTO timeline_entries
           (entry_id, session_id, run_id, entry_order, kind, text, created_at)
           VALUES (?, ?, ?, ?, 'steering', ?, ?)`,
        )
        .run(
          entryId,
          command.sessionId,
          command.runId,
          this.nextTimelineOrder(command.sessionId),
          command.text,
          now,
        );
      this.#db
        .prepare(
          `INSERT INTO steering
           (command_id, device_id, run_id, worker_generation, text, entry_id,
            state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?)`,
        )
        .run(
          command.commandId,
          deviceId,
          command.runId,
          command.workerGeneration,
          command.text,
          entryId,
          now,
        );
      this.#db
        .prepare(
          `UPDATE sessions SET timeline_revision = timeline_revision + 1
           WHERE session_id = ?`,
        )
        .run(command.sessionId);
      this.#db
        .prepare(
          `UPDATE host SET sequence = sequence + 1, committed_at = ?
           WHERE singleton = 1`,
        )
        .run(now);
      const entry = this.loadTimelineEntry(entryId);
      this.#db.exec("COMMIT");
      return {
        kind: "accepted",
        entry,
        cursor: this.status("").synchronization.cursor,
      };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  markSteering(commandId: string, deviceId: string, applied: boolean): void {
    const state = applied ? "applied" : "unapplied";
    this.#db
      .prepare(
        `UPDATE steering SET state = ?
         WHERE command_id = ? AND device_id = ? AND state = 'accepted'`,
      )
      .run(state, commandId, deviceId);
  }

  markRunSteeringUnapplied(runId: string): void {
    this.#db
      .prepare(
        `UPDATE steering SET state = 'unapplied'
         WHERE run_id = ? AND state = 'accepted'`,
      )
      .run(runId);
  }

  /** Atomically accepts an exact-target stop and removes undelivered continuation. */
  acceptStop(
    deviceId: string,
    command: StopCommand,
    activeWorkerGeneration: string | undefined,
    now: number,
  ): StopResult {
    const digest = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
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
          return {
            kind: "rejected",
            error: "command-id-conflict",
            cursor: this.status("").synchronization.cursor,
          };
        }
        const prior = stopReceiptOutcomeSchema.parse(
          JSON.parse(String(receipt.outcome_json)),
        );
        return {
          kind: "replayed",
          run: this.loadRun(prior.runId),
          entry: this.loadTimelineEntry(prior.entryId),
          withdrawn: [],
          cursor: prior.cursor,
        };
      }

      const run = this.#db
        .prepare(
          `SELECT ${RUN_RECORD_PROJECTION} FROM runs
           WHERE run_id = ? AND session_id = ?`,
        )
        .get(command.runId, command.sessionId);
      const session = timelineRevisionSchema.optional().parse(
        this.#db
          .prepare(
            `SELECT timeline_revision AS timelineRevision
             FROM sessions WHERE session_id = ?`,
          )
          .get(command.sessionId),
      );
      const cursor = this.status("").synchronization.cursor;
      const runIsExecuting =
        run !== undefined && runRecordSchema.parse(run).state === "executing";
      const targetsActiveExecution =
        runIsExecuting &&
        activeWorkerGeneration === command.workerGeneration &&
        session?.timelineRevision === command.observedTimelineRevision;
      if (!targetsActiveExecution) {
        this.#db.exec("COMMIT");
        return { kind: "rejected", error: "stale-execution", cursor };
      }

      this.#db
        .prepare("UPDATE runs SET state = 'cancelling' WHERE run_id = ?")
        .run(command.runId);
      this.#db
        .prepare(
          `UPDATE runs SET state = 'cancelled', completed_at = ?
           WHERE session_id = ? AND state IN ('queued','held')`,
        )
        .run(now, command.sessionId);
      this.#db
        .prepare(
          `UPDATE steering SET state = 'unapplied'
           WHERE run_id = ? AND state = 'accepted'`,
        )
        .run(command.runId);

      const withdrawn = this.interactions(command.sessionId).filter(
        interaction =>
          interaction.runId === command.runId &&
          (interaction.state === "open" || interaction.state === "resolving"),
      );
      this.#db
        .prepare(
          `UPDATE interactions
           SET state = 'withdrawn', revision = revision + 1,
               terminal_cause = 'run-stop', responded_at = ?,
               application_proven = 0
           WHERE run_id = ? AND state IN ('open','resolving')`,
        )
        .run(now, command.runId);

      const entryId = `entry_${randomUUID()}`;
      this.#db
        .prepare(
          `INSERT INTO timeline_entries
           (entry_id, session_id, run_id, entry_order, kind, text, created_at)
           VALUES (?, ?, ?, ?, 'lifecycle',
                   'Cancellation requested; partial output and committed side effects are preserved.', ?)`,
        )
        .run(
          entryId,
          command.sessionId,
          command.runId,
          this.nextTimelineOrder(command.sessionId),
          now,
        );
      this.#db
        .prepare(
          `UPDATE sessions SET timeline_revision = timeline_revision + 1
           WHERE session_id = ?`,
        )
        .run(command.sessionId);
      this.#db
        .prepare(
          `UPDATE host SET sequence = sequence + 1, committed_at = ?
           WHERE singleton = 1`,
        )
        .run(now);

      const committedCursor = this.status("").synchronization.cursor;
      const outcome = {
        runId: command.runId,
        entryId,
        cursor: committedCursor,
      };
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
          committedCursor,
          now,
        );
      const result: StopResult = {
        kind: "accepted",
        run: this.loadRun(command.runId),
        entry: this.loadTimelineEntry(entryId),
        withdrawn: withdrawn.map(interaction => ({
          ...interaction,
          state: "withdrawn",
          revision: interaction.revision + 1,
          terminalCause: "run-stop",
          respondedAt: now,
          applicationProven: false,
        })),
        cursor: committedCursor,
      };
      this.#db.exec("COMMIT");
      return result;
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
    this.assertAuthorityIntegrity();

    const affectedSessionIds = new Set<string>();
    for (const { runId } of this.executingRuns()) {
      const run = this.loadRun(runId);
      affectedSessionIds.add(run.sessionId);
      if (run.state === "cancelling") {
        this.settleRun(
          runId,
          "interrupted",
          "Host recovery interrupted an unproved cancellation. Partial output and committed side effects were preserved.",
          null,
          now,
        );
        continue;
      }
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
        "Host recovery interrupted execution because normal completion could not be proved. Partial output and committed side effects were preserved.",
        null,
        now,
      );
    }

    const holdQueuedRuns = this.#db.prepare(
      "UPDATE runs SET state = 'held' WHERE session_id = ? AND state = 'queued'",
    );
    for (const sessionId of affectedSessionIds) {
      holdQueuedRuns.run(sessionId);
    }
  }

  private assertAuthorityIntegrity(): void {
    const result = this.#db.prepare("PRAGMA integrity_check").get();
    if (!authorityIntegrityCheckSchema.safeParse(result).success) {
      throw new Error("authority-integrity-check-failed");
    }
  }

  /** Holds continuation and removes runtime-owned authority after worker loss. */
  recoverWorkerLoss(
    sessionId: string,
    runId: string,
    now: number,
  ): Interaction[] {
    this.markRunSteeringUnapplied(runId);
    const withdrawnInteractions: Interaction[] = [];
    for (const interaction of this.interactions(sessionId)) {
      if (
        interaction.state !== "open" &&
        interaction.state !== "resolving"
      ) {
        continue;
      }
      this.settleInteraction(
        interaction.interactionId,
        interaction.state,
        "withdrawn",
        "worker-lost",
        now,
        false,
      );
      withdrawnInteractions.push({
        ...interaction,
        state: "withdrawn",
        revision: interaction.revision + 1,
        terminalCause: "worker-lost",
        respondedAt: now,
        applicationProven: false,
      });
    }

    this.#db
      .prepare(
        "UPDATE runs SET state = 'held' WHERE session_id = ? AND state = 'queued'",
      )
      .run(sessionId);
    this.#db
      .prepare(
        "UPDATE sessions SET residency = 'sleeping' WHERE session_id = ?",
      )
      .run(sessionId);

    return withdrawnInteractions;
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
          `SELECT ${RUN_RECORD_PROJECTION} FROM runs WHERE run_id = ?`,
        )
        .get(runId);
      if (!row) {
        throw new Error("run-not-accepted");
      }

      const acceptedRun = runRecordSchema.parse(row);
      if (acceptedRun.state !== "executing" && acceptedRun.state !== "cancelling") {
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
           WHERE run_id = ? AND state IN ('executing','cancelling')`,
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
    const rows = this.#db
      .prepare(
        `SELECT ${TIMELINE_ENTRY_PROJECTION} FROM timeline_entries
         WHERE session_id = ? ORDER BY entry_order DESC LIMIT ?`,
      )
      .all(sessionId, TIMELINE_WINDOW_SIZE)
      .reverse();
    return this.createTimelineWindow(sessionId, rows);
  }

  timelinePage(
    sessionId: string,
    cursor: string,
    requestedLimit: number,
  ): TimelineWindow | null {
    const decoded = this.decodeTimelineCursor(cursor);
    if (!decoded || decoded.sessionId !== sessionId) {
      return null;
    }

    const limit = Math.max(
      1,
      Math.min(MAX_TIMELINE_PAGE_SIZE, requestedLimit),
    );
    const rows = this.#db
      .prepare(
        `SELECT ${TIMELINE_ENTRY_PROJECTION} FROM timeline_entries
         WHERE session_id = ? AND finalized = 1 AND entry_order < ?
         ORDER BY entry_order DESC LIMIT ?`,
      )
      .all(sessionId, decoded.before, limit)
      .reverse();
    return this.createTimelineWindow(sessionId, rows);
  }

  acceptedRunsForSession(sessionId: string): RunRecord[] {
    const rows = this.#db
      .prepare(
        `SELECT run_id AS runId, session_id AS sessionId,
                session_order AS sessionOrder, prompt, state
         FROM runs
         WHERE session_id = ? AND state IN ('queued','executing','held')
         ORDER BY session_order`,
      )
      .all(sessionId);
    return runRecordSchema.array().parse(rows);
  }

  readReferencedBlob(blobId: string): Buffer | null {
    const reference = this.#db
      .prepare("SELECT 1 FROM timeline_entries WHERE blob_id = ? LIMIT 1")
      .get(blobId);
    if (!reference) {
      return null;
    }
    return this.#runArtifacts.readBlob(blobId);
  }

  private hasFinalizedBefore(sessionId: string, before: number): boolean {
    return Boolean(
      this.#db
        .prepare(
          `SELECT 1 FROM timeline_entries
           WHERE session_id = ? AND finalized = 1 AND entry_order < ? LIMIT 1`,
        )
        .get(sessionId, before),
    );
  }

  private encodeTimelineCursor(sessionId: string, before: number): string {
    const status = this.status("");
    const cursor = {
      hostId: status.hostId,
      epoch: status.synchronization.epoch,
      sessionId,
      before,
    };
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
  }

  private decodeTimelineCursor(
    cursor: string,
  ): TimelineCursor | null {
    try {
      const value = timelineCursorSchema.safeParse(
        JSON.parse(Buffer.from(cursor, "base64url").toString()),
      );
      if (!value.success) {
        return null;
      }

      const status = this.status("");
      if (
        value.data.hostId !== status.hostId ||
        value.data.epoch !== status.synchronization.epoch
      ) {
        return null;
      }
      return value.data;
    } catch {
      return null;
    }
  }

  private createTimelineWindow(
    sessionId: string,
    rows: unknown[],
  ): TimelineWindow {
    const entries = timelineEntrySchema.array().parse(rows);
    const firstOrder = entries[0]?.order;
    let olderCursor: string | null = null;
    if (firstOrder && this.hasFinalizedBefore(sessionId, firstOrder)) {
      olderCursor = this.encodeTimelineCursor(sessionId, firstOrder);
    }

    return { entries, olderCursor };
  }

  interactions(sessionId: string): Interaction[] {
    const rows = this.#db
      .prepare(
        `SELECT ${INTERACTION_PROJECTION}
         FROM interactions
         WHERE session_id = ? AND state IN ('open','resolving')
         ORDER BY deadline_at IS NULL, deadline_at, created_at, interaction_id`,
      )
      .all(sessionId);
    return rows.map(row => interactionFromRow(row));
  }

  createInteraction(input: NewInteraction): CreatedInteraction {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const interaction: Interaction = {
        ...input,
        interactionId: `interaction_${randomUUID()}`,
        state: "open",
        revision: 1,
        terminalCause: null,
        respondedAt: null,
        respondingDeviceLabel: null,
        applicationProven: null,
      };
      this.#db
        .prepare(
          `INSERT INTO interactions
           (interaction_id, session_id, run_id, worker_generation,
            correlation_id, kind, payload_json, provenance, state, revision,
            created_at, deadline_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?)`,
        )
        .run(
          interaction.interactionId,
          interaction.sessionId,
          interaction.runId,
          interaction.workerGeneration,
          interaction.correlationId,
          interaction.kind,
          JSON.stringify(interaction.payload),
          interaction.provenance ?? null,
          interaction.createdAt,
          interaction.deadlineAt,
        );

      const session = this.loadSession(interaction.sessionId);
      const entryId = `entry_${randomUUID()}`;
      this.#db
        .prepare(
          `INSERT INTO timeline_entries
           (entry_id, session_id, run_id, entry_order, kind, text, created_at)
           VALUES (?, ?, ?, ?, 'interaction', ?, ?)`,
        )
        .run(
          entryId,
          interaction.sessionId,
          interaction.runId,
          this.nextTimelineOrder(interaction.sessionId),
          `${interaction.kind}: ${interaction.payload.message}`,
          interaction.createdAt,
        );
      const timelineChange = this.advanceTimelineRevision(
        interaction.sessionId,
        session.timelineRevision,
        entryId,
      );
      this.#db.exec("COMMIT");
      return { interaction, timelineChange };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  reserveInteraction(
    interactionId: string,
    revision: number,
    deviceLabel: string,
  ): Interaction | undefined {
    const changed = this.#db
      .prepare(
        `UPDATE interactions
         SET state = 'resolving', revision = revision + 1,
             responding_device_label = ?
         WHERE interaction_id = ? AND state = 'open' AND revision = ?`,
      )
      .run(deviceLabel, interactionId, revision);
    return changed.changes === 1
      ? this.loadInteraction(interactionId)
      : undefined;
  }

  settleInteraction(
    interactionId: string,
    from: ActiveInteractionState,
    state: TerminalInteractionState,
    cause: string,
    at: number,
    applicationProven: boolean,
  ): Interaction | undefined {
    const changed = this.#db
      .prepare(
        `UPDATE interactions
         SET state = ?, revision = revision + 1,
             terminal_cause = ?, responded_at = ?, application_proven = ?
         WHERE interaction_id = ? AND state = ?`,
      )
      .run(
        state,
        cause,
        at,
        applicationProven ? 1 : 0,
        interactionId,
        from,
      );
    return changed.changes === 1
      ? this.loadInteraction(interactionId)
      : undefined;
  }

  loadInteraction(interactionId: string): Interaction {
    const row = this.#db
      .prepare(
        `SELECT ${INTERACTION_PROJECTION}
         FROM interactions
         WHERE interaction_id = ?`,
      )
      .get(interactionId);
    if (!row) {
      throw new Error("unknown-interaction");
    }
    return interactionFromRow(row);
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
      .prepare(
        `SELECT run_id AS runId FROM runs
         WHERE state IN ('queued','executing','held')`,
      )
      .all();
    return activeRunReferenceSchema.array().parse(rows);
  }

  /** Worker residency is process-local evidence and never survives Host loss. */
  resetResidencyOnStartup(): void {
    this.#db.prepare(
      "UPDATE sessions SET residency = 'sleeping' WHERE residency = 'resident'",
    ).run();
  }

  executingRuns(): Array<{ runId: string }> {
    const rows = this.#db
      .prepare(
        `SELECT run_id AS runId FROM runs
         WHERE state IN ('executing','cancelling')`,
      )
      .all();
    return activeRunReferenceSchema.array().parse(rows);
  }

  runs(sessionId: string): RunRecord[] {
    const rows = this.#db
      .prepare(
        `SELECT ${RUN_RECORD_PROJECTION}
         FROM runs WHERE session_id = ? ORDER BY session_order`,
      )
      .all(sessionId);
    return runRecordSchema.array().parse(rows);
  }

  dispatchNext(sessionId: string): RunRecord | undefined {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const executingRun = this.#db
        .prepare(
          "SELECT 1 FROM runs WHERE session_id = ? AND state = 'executing'",
        )
        .get(sessionId);
      if (executingRun) {
        throw new Error("session-busy");
      }

      const row = this.#db
        .prepare(
          `SELECT ${RUN_RECORD_PROJECTION}
           FROM runs
           WHERE session_id = ? AND state = 'queued'
           ORDER BY session_order LIMIT 1`,
        )
        .get(sessionId);
      if (!row) {
        this.#db.exec("COMMIT");
        return undefined;
      }

      const run = runRecordSchema.parse(row);
      this.#db
        .prepare(
          "UPDATE runs SET state = 'executing' WHERE run_id = ? AND state = 'queued'",
        )
        .run(run.runId);
      this.#db.exec("COMMIT");
      return { ...run, state: "executing" };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  holdQueued(sessionId: string): void {
    this.#db
      .prepare(
        "UPDATE runs SET state = 'held' WHERE session_id = ? AND state = 'queued'",
      )
      .run(sessionId);
  }

  releaseRun(runId: string): RunRecord {
    const run = this.loadRun(runId);
    if (run.state !== "held") {
      throw new Error("run-not-held");
    }

    const executingRun = this.#db
      .prepare(
        "SELECT 1 FROM runs WHERE session_id = ? AND state = 'executing'",
      )
      .get(run.sessionId);
    if (executingRun) {
      throw new Error("session-busy");
    }

    const earlierRun = this.#db
      .prepare(
        `SELECT 1 FROM runs
         WHERE session_id = ? AND session_order < ?
           AND state IN ('queued','held')`,
      )
      .get(run.sessionId, run.sessionOrder);
    if (earlierRun) {
      throw new Error("run-out-of-order");
    }

    this.#db
      .prepare(
        `UPDATE runs
         SET state = CASE WHEN run_id = ? THEN 'executing' ELSE 'queued' END
         WHERE session_id = ? AND state = 'held'`,
      )
      .run(runId, run.sessionId);
    return { ...run, state: "executing" };
  }

  cancelQueuedRun(runId: string, now: number): RunRecord {
    const run = this.loadRun(runId);
    if (run.state !== "queued" && run.state !== "held") {
      throw new Error("run-not-cancellable");
    }

    this.#db
      .prepare(
        "UPDATE runs SET state = 'cancelled', completed_at = ? WHERE run_id = ?",
      )
      .run(now, runId);
    return { ...run, state: "cancelled" };
  }

  private loadRun(runId: string): RunRecord {
    const row = this.#db
      .prepare(`SELECT ${RUN_RECORD_PROJECTION} FROM runs WHERE run_id = ?`)
      .get(runId);
    return runRecordSchema.parse(row);
  }

  private insertRunReceipt(
    deviceId: string,
    commandId: string,
    digest: string,
    outcome: SubmitOutcome,
    now: number,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO command_receipts
         (device_id, command_id, envelope_digest, outcome_json,
          commit_cursor, committed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        deviceId,
        commandId,
        digest,
        JSON.stringify(outcome),
        outcome.cursor,
        now,
      );
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
                workspace_id AS workspaceId, retention, availability, residency,
                metadata_revision AS metadataRevision,
                timeline_revision AS timelineRevision,
                parent_session_id AS parentSessionId,
                fork_point_entry_id AS forkPointEntryId
         FROM sessions WHERE session_id = ?`,
      )
      .get(sessionId);
    const { availability, ...session } = sessionRowSchema.parse(row);
    return availability === "archived"
      ? { ...session, availability }
      : session;
  }

  checkpointAt(sessionId: string, entryId: string): string | undefined {
    const row = this.#db
      .prepare(
        `SELECT checkpoint FROM timeline_entries
         WHERE session_id = ? AND entry_id = ? AND kind = 'response'
           AND finalized = 1 AND checkpoint IS NOT NULL`,
      )
      .get(sessionId, entryId);
    return checkpointRowSchema.optional().parse(row)?.checkpoint;
  }

  private validateSessionScope(
    projectId: string | null,
    workspaceId: string | null,
  ): void {
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
  }

  private sessionHasActiveWork(sessionId: string): boolean {
    const activeRun = this.#db
      .prepare(
        `SELECT 1 FROM runs WHERE session_id = ?
         AND state IN ('queued','executing','held','cancelling') LIMIT 1`,
      )
      .get(sessionId);
    const activeInteraction = this.#db
      .prepare(
        `SELECT 1 FROM interactions WHERE session_id = ?
         AND state IN ('open','resolving') LIMIT 1`,
      )
      .get(sessionId);
    return Boolean(activeRun || activeInteraction);
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
      (earliestRetainedSequence === undefined ||
        decoded.sequence < earliestRetainedSequence - 1);
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

  /** Registers recovery/rollback/artifact manifest reachability in SQLite authority. */
  retainObjectReference(ownerKind: string, ownerId: string, objectId: string): void {
    this.#db.prepare(
      `INSERT OR REPLACE INTO retained_object_references
       (owner_kind, owner_id, object_id, protected) VALUES (?, ?, ?, 1)`,
    ).run(ownerKind, ownerId, objectId);
  }

  /**
   * Applies v1's minimum operational retention and conservative two-proof GC.
   * Session, ancestry, security, and product rows are deliberately never removed.
   */
  runMaintenance(now: number): MaintenanceResult {
    const day = 24 * 60 * 60 * 1_000;
    const result: MaintenanceResult = {
      receiptsCompacted: 0,
      changesCompacted: 0,
      quarantined: [],
      deleted: [],
      restored: [],
    };

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      // V1 retains security history indefinitely. Old command IDs cannot be
      // dropped without replacing their proof with an expired tombstone,
      // because doing so would revive a retry as new intent.
      result.changesCompacted = Number(this.#db.prepare(
        "DELETE FROM synchronization_changes WHERE committed_at IS NOT NULL AND committed_at < ?",
      ).run(now - 7 * day).changes);

      const referenced = new Set<string>(
        this.#db.prepare(
          `SELECT blob_id AS objectId FROM timeline_entries WHERE blob_id IS NOT NULL
           UNION SELECT object_id FROM retained_object_references WHERE protected = 1`,
        ).all().map(row => String(row.objectId)),
      );
      const tombstones = this.#db.prepare(
        "SELECT object_id AS objectId, first_proved_at AS firstProvedAt FROM storage_orphans",
      ).all() as Array<{ objectId: string; firstProvedAt: number }>;

      for (const tombstone of tombstones) {
        if (referenced.has(tombstone.objectId)) {
          this.#db.prepare("DELETE FROM storage_orphans WHERE object_id = ?").run(tombstone.objectId);
          result.restored.push(tombstone.objectId);
        } else if (now > tombstone.firstProvedAt) {
          this.#db.prepare("DELETE FROM storage_orphans WHERE object_id = ?").run(tombstone.objectId);
          result.deleted.push(tombstone.objectId);
        }
      }

      for (const digest of this.#runArtifacts.listBlobDigests()) {
        const objectId = `sha256:${digest}`;
        if (referenced.has(objectId) || tombstones.some(row => row.objectId === objectId)) continue;
        this.#db.prepare(
          "INSERT INTO storage_orphans VALUES (?, 'blob', ?, ?, 'quarantined')",
        ).run(objectId, now, randomUUID());
        result.quarantined.push(objectId);
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }

    // Physical operations follow the durable maintenance decision. A crash is
    // retried from the tombstone; no authority row can point at partial bytes.
    for (const objectId of result.restored) this.#runArtifacts.restoreBlob(objectId.slice(7));
    for (const objectId of result.quarantined) this.#runArtifacts.quarantineBlob(objectId.slice(7));
    for (const objectId of result.deleted) this.#runArtifacts.deleteQuarantinedBlob(objectId.slice(7));
    return result;
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
      .prepare("INSERT INTO synchronization_changes (sequence, payload_json, committed_at) VALUES (?, ?, (SELECT committed_at FROM host WHERE singleton=1))")
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

function interactionFromRow(row: Record<string, unknown>): Interaction {
  return interactionSchema.parse({
    ...row,
    payload: JSON.parse(String(row.payloadJson)),
    provenance: row.provenance ?? undefined,
    applicationProven: row.applicationProven == null
      ? null
      : Boolean(row.applicationProven),
  });
}
