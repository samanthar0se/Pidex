import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostStatus } from "../../protocol/src/status.js";
import type { HostAdapters } from "../../adapters/src/index.js";

const CREATE_HOST_TABLE = `
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=FULL;
  CREATE TABLE IF NOT EXISTS host (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    host_id TEXT NOT NULL,
    epoch TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    readiness TEXT NOT NULL,
    committed_at INTEGER NOT NULL
  )
`;

export class AuthorityStore {
  readonly #db: DatabaseSync;

  constructor(path: string, adapters: HostAdapters) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(CREATE_HOST_TABLE);

    const existingHost = this.#db
      .prepare("SELECT 1 FROM host WHERE singleton=1")
      .get();
    if (!existingHost) {
      adapters.storage.beforeCommit();
      this.#db
        .prepare("INSERT INTO host VALUES (1, ?, ?, 1, 'ready', ?)")
        .run(`host_${randomUUID()}`, randomUUID(), adapters.clock.now());
    }
  }

  status(releaseId: string, warnings: HostStatus["warnings"] = []): HostStatus {
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

  close(): void {
    this.#db.close();
  }
}
