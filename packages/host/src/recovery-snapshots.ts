import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  publishImmutableFile,
  publishValidatedTree,
  replaceRebuildableFile,
  writeCandidate,
} from "../../durability/src/index.js";

const SNAPSHOT_FORMAT = "pidex-online-snapshot-v1";
const DATABASE_FILE = "database.sqlite";
const MANIFEST_FILE = "manifest.json";
const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIGEST_PREFIX = "sha256:";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const manifestBodySchema = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  snapshotId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  kind: z.enum(["scheduled", "manual", "risk-boundary"]),
  protected: z.boolean(),
  barrier: z.string().min(1),
  database: z.object({ file: z.literal(DATABASE_FILE), digest: digestSchema }),
  objects: z.array(
    z.object({
      digest: digestSchema,
      size: z.number().int().nonnegative(),
    }),
  ),
  checkpoints: z.array(
    z.object({
      sessionId: z.string().min(1),
      checkpoint: z.string().min(1),
    }),
  ),
  compatibility: z.object({
    snapshotFormat: z.number().int().positive(),
    schemaVersion: z.number().int().nonnegative(),
    release: z.string().min(1),
  }),
});

const manifestEnvelopeSchema = z.object({
  body: z.string(),
  digest: digestSchema,
});

export type SnapshotManifestBody = z.infer<typeof manifestBodySchema>;
export type SnapshotManifest = SnapshotManifestBody & { manifestDigest: string };

export interface OnlineSnapshotInput {
  snapshotId: string;
  createdAt: number;
  kind: "scheduled" | "manual" | "risk-boundary";
  protected: boolean;
  barrier: string;
  database: Uint8Array;
  objects: readonly { bytes: Uint8Array; digest?: string }[];
  checkpoints: readonly { sessionId: string; checkpoint: string }[];
  compatibility: {
    snapshotFormat: number;
    schemaVersion: number;
    release: string;
  };
}

export interface SelectableSnapshot {
  snapshotId: string;
  path: string;
  manifest: SnapshotManifest;
}

type SnapshotEvent = "object-published" | "snapshot-closed";

/** Publishes and rotates complete, immutable online recovery points. */
export class OnlineSnapshotStore {
  readonly #root: string;
  readonly #onEvent?: (event: SnapshotEvent) => void;

  constructor(root: string, onEvent?: (event: SnapshotEvent) => void) {
    this.#root = root;
    this.#onEvent = onEvent;
    mkdirSync(this.objectsPath(), { recursive: true });
    mkdirSync(this.snapshotsPath(), { recursive: true });
  }

  create(input: OnlineSnapshotInput): SelectableSnapshot {
    if (!SNAPSHOT_ID_PATTERN.test(input.snapshotId)) {
      throw new Error("invalid-snapshot-id");
    }

    const objects = this.publishObjects(input.objects);

    const body: SnapshotManifestBody = manifestBodySchema.parse({
      format: SNAPSHOT_FORMAT,
      snapshotId: input.snapshotId,
      createdAt: input.createdAt,
      kind: input.kind,
      protected: input.protected,
      barrier: input.barrier,
      database: { file: DATABASE_FILE, digest: sha256(input.database) },
      objects,
      checkpoints: input.checkpoints,
      compatibility: input.compatibility,
    });
    const bodyText = JSON.stringify(body);
    const manifestText = JSON.stringify({
      body: bodyText,
      digest: sha256(bodyText),
    });
    const snapshotPath = this.snapshotPath(input.snapshotId);

    publishValidatedTree({
      target: snapshotPath,
      materialize: stage => {
        writeFileSync(join(stage, DATABASE_FILE), input.database, {
          flag: "wx",
        });
        writeFileSync(join(stage, MANIFEST_FILE), manifestText, {
          flag: "wx",
        });
      },
      validate: candidatePath =>
        this.readAndValidate(candidatePath, input.snapshotId) !== null,
    });
    this.#onEvent?.("snapshot-closed");

    return this.requireSelectable(input.snapshotId);
  }

  listSelectable(): SelectableSnapshot[] {
    const snapshots: SelectableSnapshot[] = [];

    for (const entry of readdirSync(this.snapshotsPath(), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const snapshotPath = this.snapshotPath(entry.name);
      const manifest = this.readAndValidate(snapshotPath, entry.name);
      if (manifest !== null) {
        snapshots.push({
          snapshotId: entry.name,
          path: snapshotPath,
          manifest,
        });
      }
    }

    return snapshots.sort(
      (left, right) => right.manifest.createdAt - left.manifest.createdAt,
    );
  }

  verify(snapshotId: string): { verified: true; manifestDigest: string } {
    const snapshot = this.requireSelectable(snapshotId);
    const verification = {
      verified: true as const,
      manifestDigest: snapshot.manifest.manifestDigest,
    };

    replaceRebuildableFile({
      target: this.verificationPath(snapshotId),
      materialize: writeCandidate(JSON.stringify(verification)),
      validate: path =>
        JSON.parse(readFileSync(path, "utf8")).manifestDigest ===
        verification.manifestDigest,
    });

    return verification;
  }

  rotate(options: { scheduledRetention?: number } = {}): void {
    const retention = options.scheduledRetention ?? 7;
    const selectableSnapshots = this.listSelectable();
    const scheduledSnapshots = selectableSnapshots.filter(
      snapshot =>
        snapshot.manifest.kind === "scheduled" &&
        !snapshot.manifest.protected,
    );
    const snapshotIdsToRemove = scheduledSnapshots
      .slice(retention)
      .map(snapshot => snapshot.snapshotId);

    for (const snapshotId of snapshotIdsToRemove) {
      rmSync(this.snapshotPath(snapshotId), {
        recursive: true,
        force: true,
      });
      rmSync(this.verificationPath(snapshotId), { force: true });
    }

    // Recompute reachability after rotation; invalid candidates do not authorize
    // deletion, so their objects conservatively remain until separately handled.
    const retainedSnapshots = this.listSelectable();
    const retainedSnapshotIds = new Set(
      retainedSnapshots.map(snapshot => snapshot.snapshotId),
    );
    const reachableObjects = new Set(
      retainedSnapshots.flatMap(snapshot =>
        snapshot.manifest.objects.map(object => bareDigest(object.digest)),
      ),
    );
    const hasInvalidCandidate = readdirSync(this.snapshotsPath(), {
      withFileTypes: true,
    }).some(
      entry =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !retainedSnapshotIds.has(entry.name),
    );
    if (hasInvalidCandidate) {
      return;
    }

    for (const entry of readdirSync(this.objectsPath(), {
      withFileTypes: true,
    })) {
      if (entry.isFile() && !reachableObjects.has(entry.name)) {
        rmSync(join(this.objectsPath(), entry.name));
      }
    }
  }

  private requireSelectable(snapshotId: string): SelectableSnapshot {
    const snapshot = this.listSelectable().find(
      item => item.snapshotId === snapshotId,
    );
    if (!snapshot) {
      throw new Error("snapshot-not-selectable");
    }
    return snapshot;
  }

  private publishObjects(
    objects: OnlineSnapshotInput["objects"],
  ): SnapshotManifestBody["objects"] {
    return objects.map(object => {
      const digest = sha256(object.bytes);
      if (object.digest !== undefined && object.digest !== digest) {
        throw new Error("snapshot-object-digest-mismatch");
      }

      publishImmutableFile({
        target: this.objectPath(digest),
        materialize: writeCandidate(object.bytes),
        validate: path => sha256(readFileSync(path)) === digest,
      });
      this.#onEvent?.("object-published");

      return { digest, size: object.bytes.byteLength };
    });
  }

  private readAndValidate(
    snapshotPath: string,
    expectedSnapshotId: string,
  ): SnapshotManifest | null {
    try {
      const manifestPath = join(snapshotPath, MANIFEST_FILE);
      const envelope = manifestEnvelopeSchema.parse(
        JSON.parse(readFileSync(manifestPath, "utf8")),
      );
      if (sha256(envelope.body) !== envelope.digest) {
        return null;
      }

      const body = manifestBodySchema.parse(JSON.parse(envelope.body));
      if (body.snapshotId !== expectedSnapshotId) {
        return null;
      }
      if (
        sha256(readFileSync(join(snapshotPath, body.database.file))) !==
        body.database.digest
      ) {
        return null;
      }

      for (const object of body.objects) {
        const objectPath = this.objectPath(object.digest);
        if (!existsSync(objectPath)) {
          return null;
        }

        const bytes = readFileSync(objectPath);
        if (
          bytes.byteLength !== object.size ||
          sha256(bytes) !== object.digest
        ) {
          return null;
        }
      }

      return { ...body, manifestDigest: envelope.digest };
    } catch {
      return null;
    }
  }

  private objectPath(digest: string): string {
    return join(this.objectsPath(), bareDigest(digest));
  }

  private objectsPath(): string {
    return join(this.#root, "objects");
  }

  private snapshotPath(snapshotId: string): string {
    return join(this.snapshotsPath(), snapshotId);
  }

  private snapshotsPath(): string {
    return join(this.#root, "snapshots");
  }

  private verificationPath(snapshotId: string): string {
    return join(this.#root, "verification", `${snapshotId}.json`);
  }
}

function sha256(value: string | Uint8Array): string {
  return `${DIGEST_PREFIX}${createHash("sha256").update(value).digest("hex")}`;
}

function bareDigest(digest: string): string {
  return digestSchema.parse(digest).slice(DIGEST_PREFIX.length);
}
