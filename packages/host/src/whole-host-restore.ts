import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statfsSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DataGenerationManager } from "./migration.js";

const RESTORE_WARNINGS = [
  "Restore replaces the whole Host; it never merges, imports, clones, or replays work.",
  "Captured executing/cancelling Runs become Interrupted; queued Runs remain held for review.",
  "Device authorization is restored exactly; Devices revoked after this point may become Paired again.",
  "All Clients and cursors will reset to a new synchronization epoch.",
];

interface RestoreFile {
  path: string;
  source: string;
  digest: string;
}

export interface RestoreCandidate {
  id: string;
  createdAt: number;
  kind: "snapshot" | "portable-backup";
  database: string;
  databaseDigest: string;
  files: RestoreFile[];
  identity: { hostId: string; origin: string };
  schema: number;
  release: string;
  barrier: string;
  runs: { executing: number; cancelling: number; queued: number };
  devices: { paired: number; revoked: number };
  encrypted: boolean;
  encryptionVerified: boolean;
}

export interface RestorePreview {
  candidate: RestoreCandidate;
  skipped: Array<{ id: string; reason: string }>;
  rollback: { from: string; to: string };
  identityChanges: boolean;
  collisionRisk: boolean;
  migration: { required: boolean; from: number; to: number };
  warnings: string[];
  confirmation: string;
}

interface RestoreOptions {
  root: string;
  hostId: string;
  origin: string;
  schema: number;
  release: string;
  revision: () => number;
  authorityValid: () => boolean;
  isPaired: (deviceId: string) => boolean;
  daemonStopped: () => boolean;
  migrate?: (database: DatabaseSync, fromSchema: number) => void;
  /** Runs before activation, in the copied authority transaction. */
  reconcile: (database: DatabaseSync, epoch: string) => void;
}

/** Explicit, replace-only whole-Host recovery coordinator. */
export class WholeHostRestore {
  readonly #generations: DataGenerationManager;
  readonly #previews = new Map<string, RestorePreview>();

  constructor(readonly options: RestoreOptions) {
    this.#generations = new DataGenerationManager(options.root);
  }

  preview(input: {
    candidates: RestoreCandidate[];
    deviceId?: string;
    localhost?: boolean;
    expectedRevision: number;
  }): RestorePreview {
    this.authorize(input);
    const skipped: RestorePreview["skipped"] = [];
    let selected: RestoreCandidate | undefined;
    const candidatesByNewest = [...input.candidates].sort(
      (left, right) => right.createdAt - left.createdAt,
    );
    for (const candidate of candidatesByNewest) {
      const verificationFailure = this.verify(candidate);
      if (verificationFailure) {
        skipped.push({ id: candidate.id, reason: verificationFailure });
      } else if (!selected) {
        selected = candidate;
      }
    }
    if (!selected) {
      throw new Error("no-verified-compatible-recovery-source");
    }

    const identityChanges = selected.identity.hostId !== this.options.hostId;
    const collisionRisk =
      identityChanges || selected.identity.origin !== this.options.origin;
    const confirmation = restoreConfirmation(
      selected,
      input.candidates,
      identityChanges,
    );
    const preview: RestorePreview = {
      candidate: selected,
      skipped,
      rollback: {
        from: this.#generations.active()?.directory ?? "damaged",
        to: selected.barrier,
      },
      identityChanges,
      collisionRisk,
      migration: {
        required: selected.schema !== this.options.schema,
        from: selected.schema,
        to: this.options.schema,
      },
      warnings: [...RESTORE_WARNINGS],
      confirmation,
    };
    this.#previews.set(selected.id, preview);
    return preview;
  }

  restore(input: { candidateId: string; confirmation: string }): {
    directory: string;
    epoch: string;
  } {
    if (!this.options.daemonStopped()) {
      throw new Error("daemon-must-be-stopped");
    }
    const preview = this.#previews.get(input.candidateId);
    if (!preview || input.confirmation !== preview.confirmation) {
      throw new Error("restore-confirmation-required");
    }
    const verificationFailure = this.verify(preview.candidate);
    if (verificationFailure) {
      throw new Error(`source-changed:${verificationFailure}`);
    }

    const candidate = preview.candidate;
    const directory = `restore-${candidate.createdAt}-${randomUUID()}`;
    const generationPath = join(this.options.root, "generations", directory);
    mkdirSync(generationPath, { recursive: false });
    try {
      const requiredFreeBytes = readFileSync(candidate.database).length * 2;
      const space = statfsSync(this.options.root);
      if (space.bavail * space.bsize < requiredFreeBytes) {
        throw new Error("insufficient-space");
      }
      const databasePath = join(generationPath, "authority.sqlite");
      copyFileSync(candidate.database, databasePath);
      for (const file of candidate.files) {
        const destination = join(generationPath, file.path);
        mkdirSync(join(destination, ".."), { recursive: true });
        copyFileSync(file.source, destination);
      }
      const db = new DatabaseSync(databasePath);
      const epoch = randomUUID();
      try {
        db.exec("PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE");
        this.options.migrate?.(db, candidate.schema);
        this.options.reconcile(db, epoch);
        db.exec(`PRAGMA user_version=${this.options.schema}; COMMIT`);
        assertDatabase(db);
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        db.close();
      }
      this.#generations.activate({
        release: this.options.release,
        schema: this.options.schema,
        directory,
      });
      this.#previews.clear();
      return { directory, epoch };
    } catch (error) {
      rmSync(generationPath, { recursive: true, force: true });
      throw error;
    }
  }

  private authorize(input: {
    deviceId?: string;
    localhost?: boolean;
    expectedRevision: number;
  }): void {
    if (input.expectedRevision !== this.options.revision()) {
      throw new Error("revision-conflict");
    }
    if (this.options.authorityValid()) {
      if (!input.deviceId || !this.options.isPaired(input.deviceId)) {
        throw new Error("paired-device-required");
      }
    } else if (!input.localhost) {
      throw new Error("localhost-recovery-required");
    }
  }

  private verify(candidate: RestoreCandidate): string | undefined {
    if (
      !existsSync(candidate.database) ||
      digest(candidate.database) !== candidate.databaseDigest
    ) {
      return "database-digest-failed";
    }
    if (candidate.encrypted && !candidate.encryptionVerified) {
      return "encryption-not-verified";
    }
    if (
      candidate.schema > this.options.schema ||
      (candidate.schema !== this.options.schema && !this.options.migrate)
    ) {
      return "incompatible-schema";
    }
    const hasInvalidFile = candidate.files.some(
      file =>
        !safePath(file.path) ||
        !existsSync(file.source) ||
        digest(file.source) !== file.digest,
    );
    if (hasInvalidFile) {
      return "manifest-reference-closure-failed";
    }
    if (!hasValidDatabaseIntegrity(candidate.database)) {
      return "authority-integrity-failed";
    }
    return undefined;
  }
}

function restoreConfirmation(
  candidate: RestoreCandidate,
  candidates: RestoreCandidate[],
  identityChanges: boolean,
): string {
  if (identityChanges) {
    return `REPLACE HOST IDENTITY WITH ${candidate.identity.hostId}`;
  }

  const newestCreatedAt = Math.max(...candidates.map(item => item.createdAt));
  if (candidate.createdAt < newestCreatedAt) {
    return `RESTORE OLDER ${candidate.id}`;
  }
  return `RESTORE ${candidate.id}`;
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function safePath(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    !path.split(/[\\/]/).includes("..")
  );
}

function hasValidDatabaseIntegrity(path: string): boolean {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assertDatabase(db);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

function assertDatabase(db: DatabaseSync): void {
  if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
    throw new Error("integrity-failed");
  }
  db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
}
