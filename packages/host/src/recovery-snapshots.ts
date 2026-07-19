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

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const manifestBodySchema = z.object({
  format: z.literal("pidex-online-snapshot-v1"),
  snapshotId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  kind: z.enum(["scheduled", "manual", "risk-boundary"]),
  protected: z.boolean(),
  barrier: z.string().min(1),
  database: z.object({ file: z.literal("database.sqlite"), digest: digestSchema }),
  objects: z.array(z.object({ digest: digestSchema, size: z.number().int().nonnegative() })),
  checkpoints: z.array(z.object({ sessionId: z.string().min(1), checkpoint: z.string().min(1) })),
  compatibility: z.object({
    snapshotFormat: z.number().int().positive(),
    schemaVersion: z.number().int().nonnegative(),
    release: z.string().min(1),
  }),
});

const manifestSchema = z.object({
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
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.snapshotId)) {
      throw new Error("invalid-snapshot-id");
    }
    const objects = input.objects.map(object => {
      const digest = sha256(object.bytes);
      if (object.digest !== undefined && object.digest !== digest) {
        throw new Error("snapshot-object-digest-mismatch");
      }
      publishImmutableFile({
        target: join(this.objectsPath(), bareDigest(digest)),
        materialize: writeCandidate(object.bytes),
        validate: path => sha256(readFileSync(path)) === digest,
      });
      this.#onEvent?.("object-published");
      return { digest, size: object.bytes.byteLength };
    });

    const body: SnapshotManifestBody = manifestBodySchema.parse({
      format: "pidex-online-snapshot-v1",
      snapshotId: input.snapshotId,
      createdAt: input.createdAt,
      kind: input.kind,
      protected: input.protected,
      barrier: input.barrier,
      database: { file: "database.sqlite", digest: sha256(input.database) },
      objects,
      checkpoints: input.checkpoints,
      compatibility: input.compatibility,
    });
    const bodyText = JSON.stringify(body);
    const envelope = JSON.stringify({ body: bodyText, digest: sha256(bodyText) });
    const target = join(this.snapshotsPath(), input.snapshotId);

    publishValidatedTree({
      target,
      materialize: stage => {
        writeFileSync(join(stage, "database.sqlite"), input.database, { flag: "wx" });
        writeFileSync(join(stage, "manifest.json"), envelope, { flag: "wx" });
      },
      validate: candidate => this.readAndValidate(candidate, input.snapshotId) !== null,
    });
    this.#onEvent?.("snapshot-closed");
    return this.requireSelectable(input.snapshotId);
  }

  listSelectable(): SelectableSnapshot[] {
    return readdirSync(this.snapshotsPath(), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
      .flatMap(entry => {
        const path = join(this.snapshotsPath(), entry.name);
        const manifest = this.readAndValidate(path, entry.name);
        return manifest === null ? [] : [{ snapshotId: entry.name, path, manifest }];
      })
      .sort((left, right) => right.manifest.createdAt - left.manifest.createdAt);
  }

  verify(snapshotId: string): { verified: true; manifestDigest: string } {
    const snapshot = this.requireSelectable(snapshotId);
    const result = { verified: true as const, manifestDigest: snapshot.manifest.manifestDigest };
    replaceRebuildableFile({
      target: join(this.#root, "verification", `${snapshotId}.json`),
      materialize: writeCandidate(JSON.stringify(result)),
      validate: path => JSON.parse(readFileSync(path, "utf8")).manifestDigest === result.manifestDigest,
    });
    return result;
  }

  rotate(options: { scheduledRetention?: number } = {}): void {
    const retention = options.scheduledRetention ?? 7;
    const valid = this.listSelectable();
    const scheduled = valid.filter(item => item.manifest.kind === "scheduled" && !item.manifest.protected);
    const remove = new Set(scheduled.slice(retention).map(item => item.snapshotId));
    for (const snapshotId of remove) {
      rmSync(join(this.snapshotsPath(), snapshotId), { recursive: true, force: true });
      rmSync(join(this.#root, "verification", `${snapshotId}.json`), { force: true });
    }

    // Recompute reachability after rotation; invalid candidates do not authorize
    // deletion, so their objects conservatively remain until separately handled.
    const retained = this.listSelectable();
    const reached = new Set(retained.flatMap(item => item.manifest.objects.map(object => bareDigest(object.digest))));
    const hasInvalidCandidate = readdirSync(this.snapshotsPath(), { withFileTypes: true })
      .some(entry => entry.isDirectory() && !entry.name.startsWith(".") && !retained.some(item => item.snapshotId === entry.name));
    if (!hasInvalidCandidate) {
      for (const entry of readdirSync(this.objectsPath(), { withFileTypes: true })) {
        if (entry.isFile() && !reached.has(entry.name)) {
          rmSync(join(this.objectsPath(), entry.name));
        }
      }
    }
  }

  private requireSelectable(snapshotId: string): SelectableSnapshot {
    const found = this.listSelectable().find(item => item.snapshotId === snapshotId);
    if (!found) throw new Error("snapshot-not-selectable");
    return found;
  }

  private readAndValidate(path: string, expectedId: string): SnapshotManifest | null {
    try {
      const envelope = manifestSchema.parse(JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")));
      if (sha256(envelope.body) !== envelope.digest) return null;
      const body = manifestBodySchema.parse(JSON.parse(envelope.body));
      if (body.snapshotId !== expectedId) return null;
      if (sha256(readFileSync(join(path, body.database.file))) !== body.database.digest) return null;
      for (const object of body.objects) {
        const objectPath = join(this.objectsPath(), bareDigest(object.digest));
        if (!existsSync(objectPath)) return null;
        const bytes = readFileSync(objectPath);
        if (bytes.byteLength !== object.size || sha256(bytes) !== object.digest) return null;
      }
      return { ...body, manifestDigest: envelope.digest };
    } catch {
      return null;
    }
  }

  private objectsPath(): string { return join(this.#root, "objects"); }
  private snapshotsPath(): string { return join(this.#root, "snapshots"); }
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bareDigest(digest: string): string {
  return digestSchema.parse(digest).slice("sha256:".length);
}
