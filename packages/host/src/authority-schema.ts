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
    read_through_timeline_revision INTEGER NOT NULL,
    read_state_revision INTEGER NOT NULL CHECK(read_state_revision > 0),
    latest_unread_milestone_timeline_revision INTEGER,
    parent_session_id TEXT REFERENCES sessions(session_id),
    fork_point_entry_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS command_receipts (
    command_id TEXT PRIMARY KEY,
    envelope_digest TEXT NOT NULL,
    outcome_json TEXT NOT NULL,
    commit_cursor TEXT NOT NULL,
    committed_at INTEGER NOT NULL
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
    state TEXT NOT NULL
      CHECK(state IN ('open','resolving','responded','dismissed','expired','withdrawn')),
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deadline_at INTEGER,
    terminal_cause TEXT,
    responded_at INTEGER,
    application_proven INTEGER,
    UNIQUE(session_id, worker_generation, correlation_id)
  );
  CREATE TABLE IF NOT EXISTS steering (
    command_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    worker_generation TEXT NOT NULL,
    text TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('accepted','applied','unapplied')),
    created_at INTEGER NOT NULL
  );
`;
const AUTHORITY_SCHEMA_VERSION = 1;
const AUTHORITY_TABLES = [
  "authority_generation", "command_receipts", "host", "interactions",
  "projects", "retained_object_references", "runs", "sessions", "steering",
  "storage_orphans", "synchronization_changes", "timeline_entries", "workspaces",
];

/** Opens only this exact schema, creating it when the database is fresh. */
export function initializeAuthoritySchema(database: DatabaseSync): void {
  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version);
  const hasTables = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1",
  ).get());
  if (version !== AUTHORITY_SCHEMA_VERSION && hasTables) {
    throw new Error("fresh exact-version authority required");
  }
  if (version !== 0 && version !== AUTHORITY_SCHEMA_VERSION) {
    throw new Error("fresh exact-version authority required");
  }
  if (hasTables && !hasExactTables(database)) {
    throw new Error("fresh exact-version authority required");
  }
  database.exec(CREATE_AUTHORITY_SCHEMA);
  database.exec(`PRAGMA user_version=${AUTHORITY_SCHEMA_VERSION}`);
}

function hasExactTables(database: DatabaseSync): boolean {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all().map(row => row.name);
  return JSON.stringify(tables) === JSON.stringify(AUTHORITY_TABLES);
}
