import { DatabaseSync } from "node:sqlite";

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
  CREATE TABLE IF NOT EXISTS authority_generation (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    generation_id TEXT NOT NULL,
    predecessor_id TEXT,
    activation_index INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    format_version INTEGER NOT NULL,
    release_min TEXT NOT NULL,
    release_max TEXT NOT NULL
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
    availability TEXT NOT NULL DEFAULT 'available'
      CHECK(availability IN ('available','archived')),
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
    payload_json TEXT NOT NULL
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
    state TEXT NOT NULL
      CHECK(state IN ('open','resolving','responded','dismissed','expired','withdrawn')),
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

const CREATE_CURRENT_RUNS_TABLE = `
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
`;

const SESSION_COLUMN_MIGRATIONS = new Map([
  [
    "name",
    "ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled Session'",
  ],
  [
    "availability",
    "ALTER TABLE sessions ADD COLUMN availability TEXT NOT NULL DEFAULT 'available'",
  ],
  [
    "parent_session_id",
    "ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(session_id)",
  ],
  [
    "fork_point_entry_id",
    "ALTER TABLE sessions ADD COLUMN fork_point_entry_id TEXT",
  ],
]);

const TIMELINE_COLUMN_MIGRATIONS = new Map([
  ["blob_id", "ALTER TABLE timeline_entries ADD COLUMN blob_id TEXT"],
  [
    "revision",
    "ALTER TABLE timeline_entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
  ],
  [
    "finalized",
    "ALTER TABLE timeline_entries ADD COLUMN finalized INTEGER NOT NULL DEFAULT 1",
  ],
  [
    "tool_call_id",
    "ALTER TABLE timeline_entries ADD COLUMN tool_call_id TEXT",
  ],
]);

/** Creates the current schema and upgrades databases from the legacy layout. */
export function initializeAuthoritySchema(database: DatabaseSync): void {
  database.exec(CREATE_AUTHORITY_SCHEMA);
  addMissingColumns(database, "sessions", SESSION_COLUMN_MIGRATIONS);
  addMissingColumns(
    database,
    "timeline_entries",
    TIMELINE_COLUMN_MIGRATIONS,
  );
  migrateLegacyRunsTable(database);
}

function addMissingColumns(
  database: DatabaseSync,
  table: string,
  migrations: ReadonlyMap<string, string>,
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  const existingNames = new Set(columns.map(column => column.name));
  for (const [column, statement] of migrations) {
    if (!existingNames.has(column)) {
      database.exec(statement);
    }
  }
}

function migrateLegacyRunsTable(database: DatabaseSync): void {
  const runsTable = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'",
    )
    .get();
  if (!String(runsTable?.sql ?? "").includes("'accepted'")) {
    return;
  }

  database.exec(`
    ALTER TABLE runs RENAME TO runs_legacy;
    ${CREATE_CURRENT_RUNS_TABLE}
    INSERT INTO runs
      SELECT run_id, session_id, session_order, prompt,
             CASE state WHEN 'accepted' THEN 'executing' ELSE state END,
             created_at, completed_at
      FROM runs_legacy;
    DROP TABLE runs_legacy;
  `);
}
