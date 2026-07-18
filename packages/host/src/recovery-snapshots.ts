import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const DAY = 24 * 60 * 60 * 1_000;
const KEEP_DAILY = 7;

export interface RecoveryObjectInput { path: string; livePath: string }
export interface RecoveryCheckpoint { sessionId: string; checkpoint: string }
export interface SnapshotRequest {
  kind: "scheduled" | "manual" | "risk-boundary";
  reason?: string;
  now: number;
  barrier: string;
  change: number;
  objects: RecoveryObjectInput[];
  checkpoints: RecoveryCheckpoint[];
  compatibility?: { release: string; schema: number };
}
interface RecoveryObject { path: string; digest: string; bytes: number }
export interface RecoverySnapshot {
  id: string;
  kind: SnapshotRequest["kind"];
  createdAt: number;
  barrier: string;
  change: number;
  protectedReason?: string;
  verification: "verified" | "corrupt";
  compatibility: { release: string; schema: number };
  objects: RecoveryObject[];
  checkpoints: RecoveryCheckpoint[];
  databaseDigest: string;
  restore: { executingRuns: "interrupted" };
}

interface ScheduleState { observedChange: number; lastScheduledAt?: number; lastScheduledChange?: number }

/** Managed online points. Recovery objects are copied, hashed, and shared only inside recovery/. */
export class OnlineRecoverySnapshots {
  readonly recovery: string;
  readonly manifests: string;
  readonly objects: string;
  operation: { state: "idle" | "creating" | "failed"; detail?: string } = { state: "idle" };

  constructor(readonly options: { root: string; database: string }) {
    this.recovery = join(options.root, "recovery");
    this.manifests = join(this.recovery, "snapshots");
    this.objects = join(this.recovery, "objects");
    mkdirSync(this.manifests, { recursive: true });
    mkdirSync(this.objects, { recursive: true });
  }

  async runScheduled(input: { now: number; change: number; healthySince: number; barrier?: string; objects?: RecoveryObjectInput[]; checkpoints?: RecoveryCheckpoint[] }): Promise<RecoverySnapshot | null> {
    const schedule = this.readSchedule();
    if (!schedule) {
      this.writeSchedule({ observedChange: input.change });
      return null;
    }
    if (input.change === schedule.lastScheduledChange || input.change === schedule.observedChange) return null;
    const dueAt = (schedule.lastScheduledAt ?? 0) + DAY;
    // Zero jitter is intentional and within the capped 30-minute window. A
    // missed point starts on the first healthy scheduling pass, never >2h late.
    if (input.now < dueAt || input.now < input.healthySince) return null;
    const snapshot = await this.create({ kind: "scheduled", now: input.now, change: input.change, barrier: input.barrier ?? `change:${input.change}`, objects: input.objects ?? [], checkpoints: input.checkpoints ?? [] });
    this.writeSchedule({ observedChange: input.change, lastScheduledAt: input.now, lastScheduledChange: input.change });
    return snapshot;
  }

  async create(request: SnapshotRequest): Promise<RecoverySnapshot> {
    this.operation = { state: "creating", detail: "copying coherent authority" };
    const id = `${request.now}-${randomUUID()}`;
    const directory = join(this.manifests, id);
    const staged = `${directory}.stage`;
    mkdirSync(staged);
    try {
      const source = new DatabaseSync(this.options.database, { readOnly: true });
      const database = join(staged, "authority.sqlite");
      await backup(source, database);
      source.close();
      const copied = request.objects.map(object => this.copyObject(object));
      const manifest: RecoverySnapshot = {
        id, kind: request.kind, createdAt: request.now, barrier: request.barrier,
        change: request.change,
        ...(request.kind === "scheduled" ? {} : { protectedReason: request.reason ?? request.kind }),
        verification: "verified",
        compatibility: request.compatibility ?? { release: "pidex@0.1.0", schema: 0 },
        objects: copied, checkpoints: request.checkpoints,
        databaseDigest: digest(readFileSync(database)),
        restore: { executingRuns: "interrupted" },
      };
      verifyDatabase(database);
      writeFileSync(join(staged, "manifest.json"), JSON.stringify(manifest));
      renameSync(staged, directory);
      this.rotate();
      this.operation = { state: "idle" };
      return manifest;
    } catch (error) {
      rmSync(staged, { recursive: true, force: true });
      this.operation = { state: "failed", detail: String(error) };
      throw error;
    }
  }

  async verify(id: string): Promise<RecoverySnapshot> {
    const point = this.read(id);
    const database = join(this.manifests, id, "authority.sqlite");
    const valid = existsSync(database) && digest(readFileSync(database)) === point.databaseDigest && point.objects.every(object => {
      const path = join(this.objects, object.digest);
      return existsSync(path) && digest(readFileSync(path)) === object.digest;
    });
    point.verification = valid ? "verified" : "corrupt";
    writeFileSync(join(this.manifests, id, "manifest.json"), JSON.stringify(point));
    return point;
  }

  async delete(id: string): Promise<void> {
    const point = this.read(id);
    if (point.kind === "risk-boundary") throw new Error("supported-rollback-point");
    rmSync(join(this.manifests, id), { recursive: true, force: true });
    this.collectObjects();
  }

  async status() {
    const snapshots = this.list();
    return {
      snapshots,
      storageBytes: readdirSync(this.objects).reduce((sum, file) => sum + statSync(join(this.objects, file)).size, 0),
      operation: this.operation,
    };
  }

  private copyObject(input: RecoveryObjectInput): RecoveryObject {
    const bytes = readFileSync(input.livePath);
    const objectDigest = digest(bytes);
    const destination = join(this.objects, objectDigest);
    if (!existsSync(destination)) {
      const stage = `${destination}.${randomUUID()}.stage`;
      copyFileSync(input.livePath, stage); // never hard-link the live authority
      if (digest(readFileSync(stage)) !== objectDigest) throw new Error("object-changed-during-copy");
      renameSync(stage, destination);
    } else if (digest(readFileSync(destination)) !== objectDigest) {
      throw new Error("corrupt-recovery-object");
    }
    return { path: input.path, digest: objectDigest, bytes: bytes.length };
  }

  private list(): RecoverySnapshot[] {
    return readdirSync(this.manifests, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.endsWith(".stage")).map(entry => this.read(entry.name)).sort((a, b) => b.createdAt - a.createdAt);
  }
  private read(id: string): RecoverySnapshot { return JSON.parse(readFileSync(join(this.manifests, id, "manifest.json"), "utf8")) as RecoverySnapshot; }
  private rotate(): void {
    const excess = this.list().filter(point => point.kind === "scheduled").slice(KEEP_DAILY);
    for (const point of excess) rmSync(join(this.manifests, point.id), { recursive: true, force: true });
    this.collectObjects();
  }
  private collectObjects(): void {
    const retained = new Set(this.list().flatMap(point => point.objects.map(object => object.digest)));
    for (const file of readdirSync(this.objects)) if (!retained.has(file)) rmSync(join(this.objects, file));
  }
  private readSchedule(): ScheduleState | null {
    const path = join(this.recovery, "schedule.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ScheduleState : null;
  }
  private writeSchedule(value: ScheduleState): void { writeFileSync(join(this.recovery, "schedule.json"), JSON.stringify(value)); }
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function verifyDatabase(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
  db.close();
  if (result.integrity_check !== "ok") throw new Error("snapshot-database-corrupt");
}
