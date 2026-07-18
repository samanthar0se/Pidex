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

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const SCHEDULED_SNAPSHOT_RETENTION = 7;

type SnapshotKind = "scheduled" | "manual" | "risk-boundary";

export interface RecoveryObjectInput {
  path: string;
  livePath: string;
}

export interface RecoveryCheckpoint {
  sessionId: string;
  checkpoint: string;
}

export interface SnapshotRequest {
  kind: SnapshotKind;
  reason?: string;
  now: number;
  barrier: string;
  change: number;
  objects: RecoveryObjectInput[];
  checkpoints: RecoveryCheckpoint[];
  compatibility?: { release: string; schema: number };
}

interface RecoveryObject {
  path: string;
  digest: string;
  bytes: number;
}

export interface RecoverySnapshot {
  id: string;
  kind: SnapshotKind;
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

interface ScheduleState {
  observedChange: number;
  lastScheduledAt?: number;
  lastScheduledChange?: number;
}

interface ScheduledSnapshotInput {
  now: number;
  change: number;
  healthySince: number;
  barrier?: string;
  objects?: RecoveryObjectInput[];
  checkpoints?: RecoveryCheckpoint[];
}

interface SnapshotOperation {
  state: "idle" | "creating" | "failed";
  detail?: string;
}

/** Creates and retains online recovery points with independent, deduplicated objects. */
export class OnlineRecoverySnapshots {
  readonly recovery: string;
  readonly manifests: string;
  readonly objects: string;
  operation: SnapshotOperation = { state: "idle" };

  constructor(readonly options: { root: string; database: string }) {
    this.recovery = join(options.root, "recovery");
    this.manifests = join(this.recovery, "snapshots");
    this.objects = join(this.recovery, "objects");
    mkdirSync(this.manifests, { recursive: true });
    mkdirSync(this.objects, { recursive: true });
  }

  async runScheduled(
    input: ScheduledSnapshotInput,
  ): Promise<RecoverySnapshot | null> {
    const schedule = this.readSchedule();
    if (!schedule) {
      this.writeSchedule({ observedChange: input.change });
      return null;
    }

    const authorityIsUnchanged =
      input.change === schedule.lastScheduledChange ||
      input.change === schedule.observedChange;
    if (authorityIsUnchanged) {
      return null;
    }

    const dueAt = (schedule.lastScheduledAt ?? 0) + DAY_IN_MILLISECONDS;
    // Zero jitter is intentional and within the capped 30-minute window. A
    // missed point starts on the first healthy scheduling pass, never >2h late.
    if (input.now < dueAt || input.now < input.healthySince) {
      return null;
    }

    const snapshot = await this.create({
      kind: "scheduled",
      now: input.now,
      change: input.change,
      barrier: input.barrier ?? `change:${input.change}`,
      objects: input.objects ?? [],
      checkpoints: input.checkpoints ?? [],
    });
    this.writeSchedule({
      observedChange: input.change,
      lastScheduledAt: input.now,
      lastScheduledChange: input.change,
    });
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

      const copiedObjects = request.objects.map(object =>
        this.copyObject(object),
      );
      const manifest: RecoverySnapshot = {
        id,
        kind: request.kind,
        createdAt: request.now,
        barrier: request.barrier,
        change: request.change,
        ...protectedSnapshotProperties(request),
        verification: "verified",
        compatibility: request.compatibility ?? {
          release: "pidex@0.1.0",
          schema: 0,
        },
        objects: copiedObjects,
        checkpoints: request.checkpoints,
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
    const snapshot = this.readSnapshot(id);
    const database = join(this.manifests, id, "authority.sqlite");
    const databaseIsValid =
      existsSync(database) &&
      digest(readFileSync(database)) === snapshot.databaseDigest;
    const snapshotIsValid =
      databaseIsValid &&
      snapshot.objects.every(object => this.isRecoveryObjectValid(object));

    snapshot.verification = snapshotIsValid ? "verified" : "corrupt";
    writeFileSync(
      join(this.manifests, id, "manifest.json"),
      JSON.stringify(snapshot),
    );
    return snapshot;
  }

  async delete(id: string): Promise<void> {
    const snapshot = this.readSnapshot(id);
    if (snapshot.kind === "risk-boundary") {
      throw new Error("supported-rollback-point");
    }

    rmSync(join(this.manifests, id), { recursive: true, force: true });
    this.collectObjects();
  }

  async status() {
    const snapshots = this.listSnapshots();
    return {
      snapshots,
      storageBytes: readdirSync(this.objects).reduce(
        (sum, file) => sum + statSync(join(this.objects, file)).size,
        0,
      ),
      operation: this.operation,
    };
  }

  private copyObject(input: RecoveryObjectInput): RecoveryObject {
    const bytes = readFileSync(input.livePath);
    const objectDigest = digest(bytes);
    const destination = join(this.objects, objectDigest);
    if (!existsSync(destination)) {
      const stage = `${destination}.${randomUUID()}.stage`;
      // A copy keeps recovery bytes independent from the live authority.
      copyFileSync(input.livePath, stage);
      if (digest(readFileSync(stage)) !== objectDigest) {
        throw new Error("object-changed-during-copy");
      }
      renameSync(stage, destination);
    } else if (digest(readFileSync(destination)) !== objectDigest) {
      throw new Error("corrupt-recovery-object");
    }

    return { path: input.path, digest: objectDigest, bytes: bytes.length };
  }

  private isRecoveryObjectValid(object: RecoveryObject): boolean {
    const path = join(this.objects, object.digest);
    return existsSync(path) && digest(readFileSync(path)) === object.digest;
  }

  private listSnapshots(): RecoverySnapshot[] {
    return readdirSync(this.manifests, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.endsWith(".stage"))
      .map(entry => this.readSnapshot(entry.name))
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  private readSnapshot(id: string): RecoverySnapshot {
    const manifest = readFileSync(
      join(this.manifests, id, "manifest.json"),
      "utf8",
    );
    return JSON.parse(manifest) as RecoverySnapshot;
  }

  private rotate(): void {
    const excessSnapshots = this.listSnapshots()
      .filter(snapshot => snapshot.kind === "scheduled")
      .slice(SCHEDULED_SNAPSHOT_RETENTION);
    for (const snapshot of excessSnapshots) {
      rmSync(join(this.manifests, snapshot.id), {
        recursive: true,
        force: true,
      });
    }
    this.collectObjects();
  }

  private collectObjects(): void {
    const retainedDigests = new Set(
      this.listSnapshots().flatMap(snapshot =>
        snapshot.objects.map(object => object.digest),
      ),
    );
    for (const file of readdirSync(this.objects)) {
      if (!retainedDigests.has(file)) {
        rmSync(join(this.objects, file));
      }
    }
  }

  private readSchedule(): ScheduleState | null {
    const path = join(this.recovery, "schedule.json");
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, "utf8")) as ScheduleState;
  }

  private writeSchedule(value: ScheduleState): void {
    writeFileSync(
      join(this.recovery, "schedule.json"),
      JSON.stringify(value),
    );
  }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function protectedSnapshotProperties(
  request: SnapshotRequest,
): Partial<Pick<RecoverySnapshot, "protectedReason">> {
  if (request.kind === "scheduled") {
    return {};
  }
  return { protectedReason: request.reason ?? request.kind };
}

function verifyDatabase(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  const result = db.prepare("PRAGMA integrity_check").get() as {
    integrity_check?: string;
  };
  db.close();
  if (result.integrity_check !== "ok") {
    throw new Error("snapshot-database-corrupt");
  }
}
