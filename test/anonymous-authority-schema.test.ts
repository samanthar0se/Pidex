import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { initializeAuthoritySchema } from "../packages/host/src/authority-schema.js";

test("fresh authority selects the exact anonymous schema", () => {
  const database = new DatabaseSync(":memory:");
  initializeAuthoritySchema(database);

  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all().map(row => row.name);
  assert.deepEqual(tables, [
    "authority_generation",
    "command_receipts",
    "host",
    "interactions",
    "projects",
    "retained_object_references",
    "runs",
    "sessions",
    "steering",
    "storage_orphans",
    "synchronization_changes",
    "timeline_entries",
    "workspaces",
  ]);
  assert.deepEqual(columns(database, "command_receipts"), [
    "command_id", "envelope_digest", "outcome_json", "commit_cursor", "committed_at",
  ]);
  assert.equal(columns(database, "interactions").includes("responding_device_label"), false);
  assert.equal(columns(database, "steering").includes("device_id"), false);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 1);

  database.close();
});

test("anonymous authority does not migrate an existing development schema", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE devices(device_id TEXT PRIMARY KEY)");

  assert.throws(
    () => initializeAuthoritySchema(database),
    /fresh exact-version authority required/,
  );
  assert.deepEqual(
    database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name),
    ["devices"],
  );
  database.close();
});

function columns(database: DatabaseSync, table: string): unknown[] {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}
