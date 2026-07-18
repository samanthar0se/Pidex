import { randomUUID } from "node:crypto";
import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, statSync, statfsSync, writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { PiAdapter } from "../../adapters/src/index.js";

const pointerSchema = z.object({ release: z.string(), schema: z.number().int(), directory: z.string() }).strict();
const artifactSchema = z.object({
  sessionId: z.string(), pidexVersion: z.string(), piVersion: z.string(),
  artifact: z.string(), checkpoint: z.string(),
}).strict();

export class MigrationError extends Error {
  constructor(readonly code: "incompatible-schema" | "integrity-failed" | "insufficient-space" | "recovery-basis-missing" | "validation-failed" | "artifact-migration-failed", message: string = code) {
    super(message); this.name = "MigrationError";
  }
}

export interface DataMigrationPlan {
  release: string;
  schema: number;
  supportedPriorSchemas: readonly number[];
  /** Changes only the newly materialized database. Must be deterministic. */
  migrate(db: DatabaseSync, priorSchema: number): void;
  validate?(db: DatabaseSync): void;
  requiredFreeBytes?: number;
}

/** Materializes authority generations and changes only a small atomic pointer. */
export class DataGenerationManager {
  constructor(readonly root: string) {}

  active(): { release: string; schema: number; directory: string; database: string } | null {
    const path = join(this.root, "active-generation.json");
    if (!existsSync(path)) return null;
    const value = pointerSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    return { ...value, database: join(this.root, "generations", value.directory, "authority.sqlite") };
  }

  migrate(plan: DataMigrationPlan): ReturnType<DataGenerationManager["active"]> {
    const current = this.active();
    if (!current) throw new MigrationError("recovery-basis-missing");
    if (!plan.supportedPriorSchemas.includes(current.schema)) throw new MigrationError("incompatible-schema");
    verifyDatabase(current.database);
    const needed = plan.requiredFreeBytes ?? Math.max(statSync(current.database).size * 2, 1024 * 1024);
    const space = statfsSync(this.root);
    if (space.bavail * space.bsize < needed) throw new MigrationError("insufficient-space");

    const directory = `${safe(plan.release)}-schema-${plan.schema}-${randomUUID()}`;
    const generation = join(this.root, "generations", directory);
    mkdirSync(generation, { recursive: false });
    const destination = join(generation, "authority.sqlite");
    copyFileSync(current.database, destination);
    const db = new DatabaseSync(destination);
    try {
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE");
      plan.migrate(db, current.schema);
      db.exec(`PRAGMA user_version=${plan.schema}; COMMIT`);
      verifyOpenDatabase(db);
      plan.validate?.(db);
    } catch (cause) {
      try { db.exec("ROLLBACK"); } catch {}
      throw cause instanceof MigrationError ? cause : new MigrationError("validation-failed", String(cause));
    } finally { db.close(); }
    flush(destination); flush(generation);
    this.activate({ release: plan.release, schema: plan.schema, directory });
    return this.active();
  }

  /** Rollback is continuity-breaking; rotateEpoch must commit in the selected authority first. */
  rollback(directory: string, rotateEpoch: (database: string) => void): void {
    const targetPath = join(this.root, "generations", basename(directory), "authority.sqlite");
    verifyDatabase(targetPath);
    rotateEpoch(targetPath);
    const db = new DatabaseSync(targetPath); const schema = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0); db.close();
    this.activate({ release: basename(directory).split("-schema-")[0]!, schema, directory: basename(directory) });
  }

  activate(value: { release: string; schema: number; directory: string }): void {
    mkdirSync(this.root, { recursive: true });
    const path = join(this.root, "active-generation.json");
    const staged = `${path}.${randomUUID()}.stage`;
    writeFileSync(staged, JSON.stringify(value), { flag: "wx" }); flush(staged);
    renameSync(staged, path); flush(this.root);
  }
}

export interface PiArtifactMetadata { sessionId: string; pidexVersion: string; piVersion: string; artifact: string; checkpoint: string }

/** Lazy per-Session copy migration; source manifests and bytes are immutable recovery basis. */
export class PiArtifactMigrationManager {
  constructor(readonly root: string) {}
  wake(source: PiArtifactMetadata, target: { pidexVersion: string; piVersion: string }, worker: PiAdapter): Promise<PiArtifactMetadata> {
    return this.migrate(source, target, worker);
  }
  private async migrate(source: PiArtifactMetadata, target: { pidexVersion: string; piVersion: string }, worker: PiAdapter): Promise<PiArtifactMetadata> {
    artifactSchema.parse(source);
    if (source.pidexVersion === target.pidexVersion && source.piVersion === target.piVersion) return source;
    if (!worker.migrateArtifact || !worker.flushCheckpoint) throw new MigrationError("artifact-migration-failed", "pinned-worker-migration-unavailable");
    const sourcePath = join(this.root, source.artifact);
    if (!existsSync(sourcePath)) throw new MigrationError("artifact-migration-failed", "source-artifact-missing");
    const directory = join(this.root, "artifacts", source.sessionId, `${safe(target.pidexVersion)}-${safe(target.piVersion)}`);
    mkdirSync(directory, { recursive: true });
    const staged = join(directory, `${randomUUID()}.stage`);
    copyFileSync(sourcePath, staged);
    try {
      const result = await worker.migrateArtifact({ ...target, sessionId: source.sessionId, sourcePath, destinationPath: staged, sourcePidexVersion: source.pidexVersion, sourcePiVersion: source.piVersion, targetPidexVersion: target.pidexVersion, targetPiVersion: target.piVersion });
      const stable = await worker.flushCheckpoint(source.sessionId, result.checkpoint);
      if (stable !== result.checkpoint) throw new Error("checkpoint-evidence-mismatch");
      const artifact = join("artifacts", source.sessionId, `${safe(target.pidexVersion)}-${safe(target.piVersion)}`, "artifact.pi");
      renameSync(staged, join(this.root, artifact)); flush(directory);
      const metadata = { sessionId: source.sessionId, ...target, artifact, checkpoint: stable };
      const manifest = join(directory, "manifest.json"); writeFileSync(manifest, JSON.stringify(metadata), { flag: "wx" }); flush(manifest); flush(directory);
      return metadata;
    } catch (cause) { throw new MigrationError("artifact-migration-failed", cause instanceof Error ? cause.message : String(cause)); }
  }
}

function verifyDatabase(path: string): void { if (!existsSync(path)) throw new MigrationError("recovery-basis-missing"); const db = new DatabaseSync(path, { readOnly: true }); try { verifyOpenDatabase(db); } finally { db.close(); } }
function verifyOpenDatabase(db: DatabaseSync): void { if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new MigrationError("integrity-failed"); }
function safe(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, "_"); }
function flush(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
