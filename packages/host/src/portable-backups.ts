import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
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

  publish(bundle: PortableBackupBundle, signal?: AbortSignal): PortableBackupCatalogEntry & {
    outcome: "published" | "already-published";
  } {
    signal?.throwIfAborted();
    metadataSchema.parse(bundle.metadata);

    const existing = this.entriesFromReceipts().find(
      entry => entry.operationId === bundle.metadata.operationId,
    );
    const hash = sha256(bundle.bytes);
    const bundleId = `sha256:${hash}` as const;
    if (existing && existing.bundleId !== bundleId) {
      throw new Error(`Portable backup operation collision: ${bundle.metadata.operationId}`);
    }

    const target = join(this.bundleDirectory(), `${hash}.pdxbackup`);
    const publication = publishImmutableFile({
      target,
      materialize: writeCandidate(bundle.bytes),
      validate: path => sha256(readFileSync(path)) === hash && bundle.authenticate(path),
    });

    // A cut or cancellation here leaves only an unreferenced immutable bundle.
    signal?.throwIfAborted();
    const entry: PortableBackupCatalogEntry = {
      ...bundle.metadata,
      bundleId,
      file: basename(target),
      size: bundle.bytes.length,
    };
    this.publishReceipt(entry);
    this.replaceCatalog(this.entriesFromReceipts());
    return { ...entry, outcome: publication.outcome };
  }

  catalog(): PortableBackupCatalogEntry[] {
    return catalogSchema.parse(JSON.parse(readFileSync(this.catalogPath(), "utf8")));
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
    if (!existsSync(destination) || !statSync(destination).isFile()) return false;
    const expected = /^sha256:([a-f0-9]{64})$/.exec(bundleId)?.[1];
    return Boolean(
      expected && sha256(readFileSync(destination)) === expected && authenticate(destination),
    );
  }

  private publishReceipt(entry: PortableBackupCatalogEntry): void {
    const path = join(this.receiptDirectory(), `${entry.operationId}.json`);
    const body = JSON.stringify(entry);
    publishImmutableFile({
      target: path,
      materialize: writeCandidate(body),
      validate: candidate => {
        const parsed = catalogEntrySchema.parse(JSON.parse(readFileSync(candidate, "utf8")));
        return this.entryHasExactBundle(parsed);
      },
    });
  }

  private entriesFromReceipts(): PortableBackupCatalogEntry[] {
    mkdirSync(this.receiptDirectory(), { recursive: true });
    return readdirSync(this.receiptDirectory())
      .filter(name => name.endsWith(".json"))
      .map(name =>
        catalogEntrySchema.parse(
          JSON.parse(readFileSync(join(this.receiptDirectory(), name), "utf8")),
        ),
      )
      .filter(entry => this.entryHasExactBundle(entry))
      .sort((a, b) => a.operationId.localeCompare(b.operationId));
  }

  private entryHasExactBundle(entry: PortableBackupCatalogEntry): boolean {
    const path = join(this.bundleDirectory(), entry.file);
    return (
      existsSync(path) &&
      statSync(path).isFile() &&
      statSync(path).size === entry.size &&
      entry.bundleId === `sha256:${sha256(readFileSync(path))}`
    );
  }

  private replaceCatalog(entries: PortableBackupCatalogEntry[]): void {
    replaceRebuildableFile({
      target: this.catalogPath(),
      materialize: writeCandidate(JSON.stringify(entries)),
      validate: path => catalogSchema.safeParse(JSON.parse(readFileSync(path, "utf8"))).success,
    });
  }

  private bundleDirectory(): string { return join(this.#root, "bundles"); }
  private receiptDirectory(): string { return join(this.#root, "published"); }
  private catalogPath(): string { return join(this.#root, "operations.json"); }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
