import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostStatus, ProjectSummary, SessionSummary, WorkspaceSummary } from "../../protocol/src/status.js";
import type { HostAdapters } from "../../adapters/src/index.js";

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
  CREATE TABLE IF NOT EXISTS projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(project_id),
    workspace_id TEXT REFERENCES workspaces(workspace_id),
    retention TEXT NOT NULL CHECK(retention='available'),
    residency TEXT NOT NULL CHECK(residency='sleeping'),
    metadata_revision INTEGER NOT NULL,
    timeline_revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

export interface InitialCatalog {
  projects?: ProjectSummary[];
  workspaces?: WorkspaceSummary[];
}

export class AuthorityStore {
  readonly #db: DatabaseSync;

  constructor(path: string, adapters: HostAdapters, catalog: InitialCatalog = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(CREATE_AUTHORITY_SCHEMA);

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
      this.#db.prepare("INSERT OR IGNORE INTO projects VALUES (?, ?)").run(project.projectId, project.name);
    }
    for (const workspace of catalog.workspaces ?? []) {
      this.#db.prepare("INSERT OR IGNORE INTO workspaces VALUES (?, ?, ?)").run(workspace.workspaceId, workspace.projectId, workspace.name);
    }
  }

  projection(): { projects: ProjectSummary[]; workspaces: WorkspaceSummary[]; sessions: SessionSummary[] } {
    return {
      projects: this.#db.prepare("SELECT project_id AS projectId, name FROM projects ORDER BY name").all() as ProjectSummary[],
      workspaces: this.#db.prepare("SELECT workspace_id AS workspaceId, project_id AS projectId, name FROM workspaces ORDER BY name").all() as WorkspaceSummary[],
      sessions: this.#db.prepare("SELECT session_id AS sessionId, project_id AS projectId, workspace_id AS workspaceId, retention, residency, metadata_revision AS metadataRevision, timeline_revision AS timelineRevision FROM sessions ORDER BY created_at").all() as SessionSummary[],
    };
  }

  createSession(projectId: string | null, workspaceId: string | null, now: number): { session: SessionSummary; cursor: string } {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (projectId && !this.#db.prepare("SELECT 1 FROM projects WHERE project_id=?").get(projectId)) throw new Error("unknown-project");
      if (workspaceId) {
        const workspace = this.#db.prepare("SELECT project_id FROM workspaces WHERE workspace_id=?").get(workspaceId) as { project_id?: unknown } | undefined;
        if (!workspace) throw new Error("unknown-workspace");
        if (!projectId || workspace.project_id !== projectId) throw new Error("workspace-project-mismatch");
      }
      const session: SessionSummary = { sessionId: `session_${randomUUID()}`, projectId, workspaceId, retention: "available", residency: "sleeping", metadataRevision: 1, timelineRevision: 1 };
      this.#db.prepare("INSERT INTO sessions VALUES (?, ?, ?, 'available', 'sleeping', 1, 1, ?)").run(session.sessionId, projectId, workspaceId, now);
      this.#db.prepare("UPDATE host SET sequence=sequence+1, committed_at=? WHERE singleton=1").run(now);
      const status = this.status("");
      this.#db.exec("COMMIT");
      return { session, cursor: status.synchronization.cursor };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
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
        cursor: `${row.host_id}:${row.epoch}:${row.sequence}`,
      },
    };
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
