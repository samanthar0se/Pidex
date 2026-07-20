import { randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { PiAdapter } from "../../adapters/src/index.js";

const ACTIVE_GENERATION_FILE = "active-generation.json";
const AUTHORITY_DATABASE_FILE = "authority.sqlite";

const pointerSchema = z
  .object({
    release: z.string(),
    schema: z.number().int(),
    directory: z.string(),
  })
  .strict();

const artifactSchema = z
  .object({
    sessionId: z.string(),
    pidexVersion: z.string(),
    piVersion: z.string(),
    artifact: z.string(),
    checkpoint: z.string(),
  })
  .strict();

type MigrationErrorCode =
  | "incompatible-schema"
  | "integrity-failed"
  | "insufficient-space"
  | "recovery-basis-missing"
  | "validation-failed"
  | "artifact-migration-failed";

interface GenerationPointer {
  release: string;
  schema: number;
  directory: string;
}

interface ActiveGeneration extends GenerationPointer {
  database: string;
}

interface PiArtifactTarget {
  pidexVersion: string;
  piVersion: string;
}

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "MigrationError";
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
  /** Creates the protected rollback point after preflight and before any new generation. */
  createProtectedRecoverySnapshot?: () => void;
}

/** Materializes authority generations and changes only a small atomic pointer. */
export class DataGenerationManager {
  constructor(readonly root: string) {}

  active(): ActiveGeneration | null {
    const pointerPath = join(this.root, ACTIVE_GENERATION_FILE);
    if (!existsSync(pointerPath)) {
      return null;
    }

    const pointer = pointerSchema.parse(
      JSON.parse(readFileSync(pointerPath, "utf8")),
    );
    return {
      ...pointer,
      database: join(
        this.root,
        "generations",
        pointer.directory,
        AUTHORITY_DATABASE_FILE,
      ),
    };
  }

  migrate(plan: DataMigrationPlan): ActiveGeneration | null {
    const current = this.active();
    if (!current) {
      throw new MigrationError("recovery-basis-missing");
    }
    if (!plan.supportedPriorSchemas.includes(current.schema)) {
      throw new MigrationError("incompatible-schema");
    }

    verifyDatabase(current.database);
    const requiredFreeBytes =
      plan.requiredFreeBytes ??
      Math.max(statSync(current.database).size * 2, 1024 * 1024);
    const space = statfsSync(this.root);
    if (space.bavail * space.bsize < requiredFreeBytes) {
      throw new MigrationError("insufficient-space");
    }

    plan.createProtectedRecoverySnapshot?.();

    const directory = `${sanitizePathSegment(plan.release)}-schema-${plan.schema}-${randomUUID()}`;
    const generation = join(this.root, "generations", directory);
    mkdirSync(generation, { recursive: false });
    const destination = join(generation, AUTHORITY_DATABASE_FILE);
    copyFileSync(current.database, destination);

    const db = new DatabaseSync(destination);
    try {
      db.exec(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE",
      );
      plan.migrate(db, current.schema);
      db.exec(`PRAGMA user_version=${plan.schema}; COMMIT`);
      verifyOpenDatabase(db);
      plan.validate?.(db);
    } catch (cause) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw cause instanceof MigrationError
        ? cause
        : new MigrationError("validation-failed", String(cause));
    } finally {
      db.close();
    }

    flushPath(destination);
    flushPath(generation);
    this.activate({ release: plan.release, schema: plan.schema, directory });
    return this.active();
  }

  /** Rollback is continuity-breaking; rotateEpoch must commit in the selected authority first. */
  rollback(directory: string, rotateEpoch: (database: string) => void): void {
    const targetDirectory = basename(directory);
    const targetPath = join(
      this.root,
      "generations",
      targetDirectory,
      AUTHORITY_DATABASE_FILE,
    );
    verifyDatabase(targetPath);
    rotateEpoch(targetPath);

    const db = new DatabaseSync(targetPath);
    const schema = Number(
      db.prepare("PRAGMA user_version").get()?.user_version ?? 0,
    );
    db.close();

    this.activate({
      release: targetDirectory.split("-schema-")[0]!,
      schema,
      directory: targetDirectory,
    });
  }

  activate(pointer: GenerationPointer): void {
    mkdirSync(this.root, { recursive: true });
    const pointerPath = join(this.root, ACTIVE_GENERATION_FILE);
    const stagedPath = `${pointerPath}.${randomUUID()}.stage`;
    writeFileSync(stagedPath, JSON.stringify(pointer), { flag: "wx" });
    flushPath(stagedPath);
    renameSync(stagedPath, pointerPath);
    flushPath(this.root);
  }
}

export interface PiArtifactMetadata {
  sessionId: string;
  pidexVersion: string;
  piVersion: string;
  artifact: string;
  checkpoint: string;
}

/** Lazy per-Session copy migration; source manifests and bytes are immutable recovery basis. */
export class PiArtifactMigrationManager {
  constructor(readonly root: string) {}

  async wake(
    source: PiArtifactMetadata,
    target: PiArtifactTarget,
    worker: PiAdapter,
  ): Promise<PiArtifactMetadata> {
    artifactSchema.parse(source);
    if (
      source.pidexVersion === target.pidexVersion &&
      source.piVersion === target.piVersion
    ) {
      return source;
    }
    if (!worker.migrateArtifact || !worker.flushCheckpoint) {
      throw new MigrationError(
        "artifact-migration-failed",
        "pinned-worker-migration-unavailable",
      );
    }

    const sourcePath = join(this.root, source.artifact);
    if (!existsSync(sourcePath)) {
      throw new MigrationError(
        "artifact-migration-failed",
        "source-artifact-missing",
      );
    }

    const targetVersionDirectory = `${sanitizePathSegment(target.pidexVersion)}-${sanitizePathSegment(target.piVersion)}`;
    const directory = join(
      this.root,
      "artifacts",
      source.sessionId,
      targetVersionDirectory,
    );
    mkdirSync(directory, { recursive: true });
    const stagedPath = join(directory, `${randomUUID()}.stage`);
    copyFileSync(sourcePath, stagedPath);

    try {
      const result = await worker.migrateArtifact({
        ...target,
        sessionId: source.sessionId,
        sourcePath,
        destinationPath: stagedPath,
        sourcePidexVersion: source.pidexVersion,
        sourcePiVersion: source.piVersion,
        targetPidexVersion: target.pidexVersion,
        targetPiVersion: target.piVersion,
      });
      const stableCheckpoint = await worker.flushCheckpoint(
        source.sessionId,
        result.checkpoint,
      );
      if (stableCheckpoint !== result.checkpoint) {
        throw new Error("checkpoint-evidence-mismatch");
      }

      const artifact = join(
        "artifacts",
        source.sessionId,
        targetVersionDirectory,
        "artifact.pi",
      );
      renameSync(stagedPath, join(this.root, artifact));
      flushPath(directory);

      const metadata = {
        sessionId: source.sessionId,
        ...target,
        artifact,
        checkpoint: stableCheckpoint,
      };
      const manifestPath = join(directory, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify(metadata), { flag: "wx" });
      flushPath(manifestPath);
      flushPath(directory);
      return metadata;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new MigrationError("artifact-migration-failed", message);
    }
  }
}

function verifyDatabase(path: string): void {
  if (!existsSync(path)) {
    throw new MigrationError("recovery-basis-missing");
  }

  const db = new DatabaseSync(path, { readOnly: true });
  try {
    verifyOpenDatabase(db);
  } finally {
    db.close();
  }
}

function verifyOpenDatabase(db: DatabaseSync): void {
  const integrityCheck = db.prepare("PRAGMA integrity_check").get();
  if (integrityCheck?.integrity_check !== "ok") {
    throw new MigrationError("integrity-failed");
  }

  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length > 0) {
    throw new MigrationError("integrity-failed");
  }
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function flushPath(path: string): void {
  const isDirectory = statSync(path).isDirectory();
  if (isDirectory && process.platform === "win32") {
    return;
  }

  const descriptor = openSync(path, isDirectory ? "r" : "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
