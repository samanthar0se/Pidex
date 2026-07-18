import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostStatus } from "../../protocol/src/status.js";
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
`;

export class AuthorityStore {
  readonly #db: DatabaseSync;

  constructor(path: string, adapters: HostAdapters) {
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
        .prepare("INSERT INTO revoked_devices VALUES (?, ?, ?)")
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
