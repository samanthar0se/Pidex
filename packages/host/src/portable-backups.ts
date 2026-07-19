import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import {
  publishImmutableFile,
  replaceRebuildableFile,
  writeCandidate,
} from "../../durability/src/index.js";

const metadataSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  barrier: z.number().int().nonnegative(),
  compatibility: z.string().min(1),
});
const catalogEntrySchema = metadataSchema.extend({
  bundleId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  file: z.string().regex(/^[a-f0-9]{64}\.pdxbackup$/),
  size: z.number().int().nonnegative(),
});
const catalogSchema = z.array(catalogEntrySchema);

export type PortableBackupMetadata = z.infer<typeof metadataSchema>;
export type PortableBackupCatalogEntry = z.infer<typeof catalogEntrySchema>;
export type PortableBackupPublicationResult = PortableBackupCatalogEntry & {
  outcome: "published" | "already-published";
};

export interface PortableBackupBundle {
  bytes: Buffer;
  metadata: PortableBackupMetadata;
  /** Must decrypt/authenticate and verify the complete bundle at this path. */
  authenticate(path: string): boolean;
}

/** Publishes Host-owned backup bundles. User destination copies are not owned here. */
export class PortableBackupPublisher {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  publish(
    bundle: PortableBackupBundle,
    signal?: AbortSignal,
  ): PortableBackupPublicationResult {
    signal?.throwIfAborted();
    metadataSchema.parse(bundle.metadata);

    const existing = this.entriesFromReceipts().find(
      entry => entry.operationId === bundle.metadata.operationId,
    );
    const bundleHash = sha256(bundle.bytes);
    const bundleId = `sha256:${bundleHash}` as const;
    if (existing && existing.bundleId !== bundleId) {
      throw new Error(
        `Portable backup operation collision: ${bundle.metadata.operationId}`,
      );
    }

    const bundlePath = join(
      this.bundleDirectory(),
      `${bundleHash}.pdxbackup`,
    );
    const publication = publishImmutableFile({
      target: bundlePath,
      materialize: writeCandidate(bundle.bytes),
      validate: path =>
        sha256(readFileSync(path)) === bundleHash && bundle.authenticate(path),
    });

    // A cut or cancellation here leaves only an unreferenced immutable bundle.
    signal?.throwIfAborted();
    const entry: PortableBackupCatalogEntry = {
      ...bundle.metadata,
      bundleId,
      file: basename(bundlePath),
      size: bundle.bytes.length,
    };
    this.publishReceipt(entry);
    this.replaceCatalog(this.entriesFromReceipts());
    return { ...entry, outcome: publication.outcome };
  }

  catalog(): PortableBackupCatalogEntry[] {
    return catalogSchema.parse(readJsonFile(this.catalogPath()));
  }

  rebuildCatalog(): PortableBackupCatalogEntry[] {
    const entries = this.entriesFromReceipts();
    this.replaceCatalog(entries);
    return entries;
  }

  verifyDestination(
    bundleId: string,
    destination: string,
    authenticate: (path: string) => boolean,
  ): boolean {
    if (!existsSync(destination) || !statSync(destination).isFile()) {
      return false;
    }

    const expectedHash = /^sha256:([a-f0-9]{64})$/.exec(bundleId)?.[1];
    return Boolean(
      expectedHash &&
        sha256(readFileSync(destination)) === expectedHash &&
        authenticate(destination),
    );
  }

  private publishReceipt(entry: PortableBackupCatalogEntry): void {
    const receiptPath = join(
      this.receiptDirectory(),
      `${entry.operationId}.json`,
    );
    const serializedEntry = JSON.stringify(entry);
    publishImmutableFile({
      target: receiptPath,
      materialize: writeCandidate(serializedEntry),
      validate: candidate => {
        const receipt = this.readReceipt(candidate);
        return this.entryHasExactBundle(receipt);
      },
    });
  }

  private entriesFromReceipts(): PortableBackupCatalogEntry[] {
    const receiptDirectory = this.receiptDirectory();
    mkdirSync(receiptDirectory, { recursive: true });

    return readdirSync(receiptDirectory)
      .filter(name => name.endsWith(".json"))
      .map(name => this.readReceipt(join(receiptDirectory, name)))
      .filter(entry => this.entryHasExactBundle(entry))
      .sort((left, right) =>
        left.operationId.localeCompare(right.operationId),
      );
  }

  private readReceipt(path: string): PortableBackupCatalogEntry {
    return catalogEntrySchema.parse(readJsonFile(path));
  }

  private entryHasExactBundle(entry: PortableBackupCatalogEntry): boolean {
    const bundlePath = join(this.bundleDirectory(), entry.file);
    return (
      existsSync(bundlePath) &&
      statSync(bundlePath).isFile() &&
      statSync(bundlePath).size === entry.size &&
      entry.bundleId === `sha256:${sha256(readFileSync(bundlePath))}`
    );
  }

  private replaceCatalog(entries: PortableBackupCatalogEntry[]): void {
    replaceRebuildableFile({
      target: this.catalogPath(),
      materialize: writeCandidate(JSON.stringify(entries)),
      validate: path => catalogSchema.safeParse(readJsonFile(path)).success,
    });
  }

  private bundleDirectory(): string {
    return join(this.#root, "bundles");
  }

  private receiptDirectory(): string {
    return join(this.#root, "published");
  }

  private catalogPath(): string {
    return join(this.#root, "operations.json");
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
