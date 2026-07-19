import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { HostAdapters } from "../../adapters/src/index.js";
import {
  publishValidatedTree,
  replaceRebuildableFile,
} from "../../durability/src/index.js";
import { AuthorityStore, type InitialCatalog } from "./store.js";

const GENERATION_FORMAT_VERSION = 1;
const AUTHORITY_SCHEMA_VERSION = 1;
const generationIdSchema = z.string().regex(/^generation_[0-9a-f-]{36}$/);
const envelopeSchema = z.object({
  generationId: generationIdSchema,
  predecessorId: generationIdSchema.nullable(),
  activationIndex: z.number().int().positive(),
  schemaVersion: z.literal(AUTHORITY_SCHEMA_VERSION),
  formatVersion: z.literal(GENERATION_FORMAT_VERSION),
  releaseMin: z.string().regex(/^\d+\.\d+\.\d+$/),
  releaseMax: z.string().regex(/^\d+\.\d+\.\d+$/),
  objects: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
});
export type AuthorityGenerationEnvelope = z.infer<typeof envelopeSchema>;

export type AuthorityGenerationFailure =
  | "no-valid-generation"
  | "invalid-generation"
  | "incompatible-generation"
  | "ambiguous-activation-index"
  | "forked-lineage"
  | "broken-lineage"
  | "absent-closure";

export class AuthorityGenerationError extends Error {
  constructor(readonly code: AuthorityGenerationFailure, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AuthorityGenerationError";
  }
}

interface AuthorityGenerationCandidate {
  directory: string;
  envelope: AuthorityGenerationEnvelope;
}

/** Owns canonical Authority discovery. The selector is output, never input. */
export class AuthorityGenerationStore {
  readonly #dataDir: string;
  readonly #authorityDirectory: string;
  readonly #generationsDirectory: string;
  readonly #objectsDirectory: string;

  constructor(
    dataDir: string,
    readonly release: string,
    readonly adapters: HostAdapters,
  ) {
    this.#dataDir = dataDir;
    this.#authorityDirectory = join(dataDir, "authority");
    this.#generationsDirectory = join(
      this.#authorityDirectory,
      "generations",
    );
    this.#objectsDirectory = join(this.#authorityDirectory, "objects");
    mkdirSync(this.#generationsDirectory, { recursive: true });
    mkdirSync(this.#objectsDirectory, { recursive: true });
  }

  open(catalog: InitialCatalog = {}): AuthorityStore {
    if (this.#sealedDirectories().length === 0) {
      this.#createGenesis(catalog);
    }

    return this.#openCanonical(catalog);
  }

  /** Uses legacy authority until canonical state has already been published. */
  openBridge(catalog: InitialCatalog = {}): AuthorityStore {
    if (this.#sealedDirectories().length === 0) {
      return new AuthorityStore(
        join(this.#dataDir, "authority.sqlite"),
        this.adapters,
        catalog,
      );
    }

    return this.#openCanonical(catalog);
  }

  #openCanonical(catalog: InitialCatalog): AuthorityStore {
    const selected = this.#select();
    this.#repairSelector(selected.envelope.generationId);
    return new AuthorityStore(
      join(selected.directory, "authority.sqlite"),
      this.adapters,
      catalog,
    );
  }

  #sealedDirectories(): string[] {
    return readdirSync(this.#generationsDirectory, { withFileTypes: true })
      .filter(
        entry =>
          entry.isDirectory() &&
          existsSync(
            join(this.#generationsDirectory, entry.name, "SEALED"),
          ),
      )
      .map(entry => join(this.#generationsDirectory, entry.name));
  }

  #createGenesis(catalog: InitialCatalog): void {
    const generationId = `generation_${randomUUID()}`;
    const envelope: AuthorityGenerationEnvelope = {
      generationId,
      predecessorId: null,
      activationIndex: 1,
      schemaVersion: AUTHORITY_SCHEMA_VERSION,
      formatVersion: GENERATION_FORMAT_VERSION,
      releaseMin: this.release,
      releaseMax: this.release,
      objects: [],
    };
    publishValidatedTree({
      target: join(this.#generationsDirectory, generationId),
      materialize: stage => {
        const store = new AuthorityStore(
          join(stage, "authority.sqlite"),
          this.adapters,
          catalog,
        );
        store.initializeGeneration(envelope);
        store.close();
        writeFileSync(join(stage, "envelope.json"), JSON.stringify(envelope));
        writeFileSync(join(stage, "SEALED"), "sealed\n");
      },
      validate: stage => {
        this.#validateDirectory(stage);
      },
    });
  }

  #select(): AuthorityGenerationCandidate {
    const candidates = this.#sealedDirectories().map(directory =>
      this.#validateDirectory(directory),
    );
    if (candidates.length === 0) {
      throw new AuthorityGenerationError("no-valid-generation");
    }

    const activationIndexes = new Set<number>();
    const candidatesById = new Map(
      candidates.map(candidate => [
        candidate.envelope.generationId,
        candidate,
      ]),
    );
    const childCountsByPredecessor = new Map<string, number>();

    for (const candidate of candidates) {
      const envelope = candidate.envelope;
      if (activationIndexes.has(envelope.activationIndex)) {
        throw new AuthorityGenerationError("ambiguous-activation-index");
      }
      activationIndexes.add(envelope.activationIndex);

      if (
        !releaseWithin(
          this.release,
          envelope.releaseMin,
          envelope.releaseMax,
        )
      ) {
        throw new AuthorityGenerationError(
          "incompatible-generation",
          envelope.generationId,
        );
      }

      if (envelope.predecessorId) {
        if (!candidatesById.has(envelope.predecessorId)) {
          throw new AuthorityGenerationError("broken-lineage");
        }
        childCountsByPredecessor.set(
          envelope.predecessorId,
          (childCountsByPredecessor.get(envelope.predecessorId) ?? 0) + 1,
        );
      }
    }

    if ([...childCountsByPredecessor.values()].some(count => count > 1)) {
      throw new AuthorityGenerationError("forked-lineage");
    }

    const roots = candidates.filter(
      candidate => candidate.envelope.predecessorId === null,
    );
    if (roots.length !== 1) {
      throw new AuthorityGenerationError("broken-lineage");
    }

    let selected = candidates[0]!;
    for (const candidate of candidates) {
      if (
        candidate.envelope.activationIndex >
        selected.envelope.activationIndex
      ) {
        selected = candidate;
      }
    }

    let visited = 0;
    let cursor: AuthorityGenerationCandidate | undefined = selected;
    while (cursor) {
      visited += 1;
      const predecessorId = cursor.envelope.predecessorId;
      if (predecessorId) {
        cursor = candidatesById.get(predecessorId);
      } else {
        cursor = undefined;
      }
    }
    if (visited !== candidates.length) {
      throw new AuthorityGenerationError("broken-lineage");
    }

    return selected;
  }

  #validateDirectory(directory: string): AuthorityGenerationCandidate {
    try {
      const envelope = this.#readEnvelope(directory);
      this.#assertDirectoryIdentity(directory, envelope.generationId);
      this.#validateObjectClosure(envelope.objects);
      this.#validateDatabaseMetadata(directory, envelope);
      return { directory, envelope };
    } catch (error) {
      if (error instanceof AuthorityGenerationError) {
        throw error;
      }
      throw new AuthorityGenerationError(
        "invalid-generation",
        `${basename(directory)}: ${String(error)}`,
      );
    }
  }

  #readEnvelope(directory: string): AuthorityGenerationEnvelope {
    const envelopePath = join(directory, "envelope.json");
    return envelopeSchema.parse(
      JSON.parse(readFileSync(envelopePath, "utf8")),
    );
  }

  #assertDirectoryIdentity(directory: string, generationId: string): void {
    const directoryName = basename(directory);
    if (
      directoryName !== generationId &&
      !directoryName.startsWith(`.${generationId}.`)
    ) {
      throw new Error("directory identity disagreement");
    }
  }

  #validateObjectClosure(digests: string[]): void {
    for (const digest of digests) {
      const objectPath = join(this.#objectsDirectory, digest);
      const objectExists = existsSync(objectPath);
      const actualDigest = objectExists
        ? createHash("sha256").update(readFileSync(objectPath)).digest("hex")
        : undefined;

      if (actualDigest !== digest) {
        throw new AuthorityGenerationError("absent-closure", digest);
      }
    }
  }

  #validateDatabaseMetadata(
    directory: string,
    envelope: AuthorityGenerationEnvelope,
  ): void {
    const database = new DatabaseSync(join(directory, "authority.sqlite"), {
      readOnly: true,
    });
    try {
      const row = database
        .prepare("SELECT * FROM authority_generation WHERE singleton=1")
        .get();
      if (!row) {
        throw new Error("SQLite metadata disagreement");
      }

      const expected = [
        envelope.generationId,
        envelope.predecessorId,
        envelope.activationIndex,
        envelope.schemaVersion,
        envelope.formatVersion,
        envelope.releaseMin,
        envelope.releaseMax,
      ];
      const actual = [
        row.generation_id,
        row.predecessor_id,
        row.activation_index,
        row.schema_version,
        row.format_version,
        row.release_min,
        row.release_max,
      ];
      if (expected.some((value, index) => value !== actual[index])) {
        throw new Error("SQLite metadata disagreement");
      }
    } finally {
      database.close();
    }
  }

  #repairSelector(generationId: string): void {
    replaceRebuildableFile({
      target: join(this.#authorityDirectory, "Generation"),
      materialize: stage => writeFileSync(stage, `${generationId}\n`),
      validate: candidate =>
        readFileSync(candidate, "utf8") === `${generationId}\n`,
    });
  }
}

function releaseWithin(
  release: string,
  minimum: string,
  maximum: string,
): boolean {
  const current = releaseParts(release);
  return (
    compareReleases(current, releaseParts(minimum)) >= 0 &&
    compareReleases(current, releaseParts(maximum)) <= 0
  );
}

function releaseParts(release: string): number[] {
  return release.split(".").map(Number);
}

function compareReleases(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index]! - right[index]!;
    }
  }
  return 0;
}
