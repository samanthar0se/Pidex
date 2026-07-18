import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { HostAdapters } from "../../adapters/src/index.js";
import {
  hostChangeSchema,
  projectSummarySchema,
  sessionSummarySchema,
  workspaceSummarySchema,
  type HostChange,
  type HostStatus,
  type ProjectSummary,
  type SessionSummary,
  type WorkspaceSummary,
} from "../../protocol/src/status.js";

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
    residency TEXT NOT NULL CHECK(residency='sleeping'),
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
`;

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

  constructor(path: string, adapters: HostAdapters, catalog: InitialCatalog = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(CREATE_AUTHORITY_SCHEMA);
    const sessionColumns = this.#db.prepare("PRAGMA table_info(sessions)").all();
    if (!sessionColumns.some(column => column.name === "name")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled Session'",
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
