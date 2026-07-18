import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostStatus } from "../../protocol/src/status.js";
import type { HostAdapters } from "../../adapters/src/index.js";

export class AuthorityStore {
  readonly #db: DatabaseSync;
  constructor(path: string, adapters: HostAdapters) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS host (singleton INTEGER PRIMARY KEY CHECK(singleton=1), host_id TEXT NOT NULL, epoch TEXT NOT NULL, sequence INTEGER NOT NULL, readiness TEXT NOT NULL, committed_at INTEGER NOT NULL)");
    const existing = this.#db.prepare("SELECT 1 FROM host WHERE singleton=1").get();
    if (!existing) {
      adapters.storage.beforeCommit();
      this.#db.prepare("INSERT INTO host VALUES (1, ?, ?, 1, 'ready', ?)").run(`host_${randomUUID()}`, randomUUID(), adapters.clock.now());
    }
  }
  status(releaseId: string): HostStatus {
    const row = this.#db.prepare("SELECT host_id, epoch, sequence FROM host WHERE singleton=1").get() as {host_id:string; epoch:string; sequence:number};
    return { hostId: row.host_id, releaseId, readiness: "ready", synchronization: { epoch: row.epoch, sequence: row.sequence, cursor: `${row.host_id}:${row.epoch}:${row.sequence}` } };
  }
  close() { this.#db.close(); }
}
