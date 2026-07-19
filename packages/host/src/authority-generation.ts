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

const GENERATION_FORMAT = 1;
const AUTHORITY_SCHEMA = 1;
const safeId = z.string().regex(/^generation_[0-9a-f-]{36}$/);
const envelopeSchema = z.object({
  generationId: safeId,
  predecessorId: safeId.nullable(),
  activationIndex: z.number().int().positive(),
  schemaVersion: z.literal(AUTHORITY_SCHEMA),
  formatVersion: z.literal(GENERATION_FORMAT),
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

interface Candidate {
  directory: string;
  envelope: AuthorityGenerationEnvelope;
}

/** Owns canonical Authority discovery. The selector is output, never input. */
export class AuthorityGenerationStore {
  readonly #root: string;
  readonly #generations: string;
  readonly #objects: string;

  constructor(
    dataDir: string,
    readonly release: string,
    readonly adapters: HostAdapters,
  ) {
    this.#root = join(dataDir, "authority");
    this.#generations = join(this.#root, "generations");
    this.#objects = join(this.#root, "objects");
    mkdirSync(this.#generations, { recursive: true });
    mkdirSync(this.#objects, { recursive: true });
  }

  open(catalog: InitialCatalog = {}): AuthorityStore {
    if (this.#sealedDirectories().length === 0) this.#createGenesis(catalog);
    const selected = this.#select();
    this.#repairSelector(selected.envelope.generationId);
    return new AuthorityStore(
      join(selected.directory, "authority.sqlite"),
      this.adapters,
      catalog,
    );
  }

  #sealedDirectories(): string[] {
    return readdirSync(this.#generations, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(this.#generations, entry.name, "SEALED")))
      .map(entry => join(this.#generations, entry.name));
  }

  #createGenesis(catalog: InitialCatalog): void {
    const generationId = `generation_${randomUUID()}`;
    const envelope: AuthorityGenerationEnvelope = {
      generationId,
      predecessorId: null,
      activationIndex: 1,
      schemaVersion: AUTHORITY_SCHEMA,
      formatVersion: GENERATION_FORMAT,
      releaseMin: this.release,
      releaseMax: this.release,
      objects: [],
    };
    publishValidatedTree({
      target: join(this.#generations, generationId),
      materialize: stage => {
        const store = new AuthorityStore(join(stage, "authority.sqlite"), this.adapters, catalog);
        store.initializeGeneration(envelope);
        store.close();
        writeFileSync(join(stage, "envelope.json"), JSON.stringify(envelope));
        writeFileSync(join(stage, "SEALED"), "sealed\n");
      },
      validate: stage => { this.#validateDirectory(stage); },
    });
  }

  #select(): Candidate {
    const candidates = this.#sealedDirectories().map(directory => this.#validateDirectory(directory));
    if (candidates.length === 0) throw new AuthorityGenerationError("no-valid-generation");
    const indexes = new Set<number>();
    const byId = new Map(candidates.map(candidate => [candidate.envelope.generationId, candidate]));
    const children = new Map<string, number>();
    for (const candidate of candidates) {
      const envelope = candidate.envelope;
      if (indexes.has(envelope.activationIndex)) throw new AuthorityGenerationError("ambiguous-activation-index");
      indexes.add(envelope.activationIndex);
      if (!releaseWithin(this.release, envelope.releaseMin, envelope.releaseMax)) {
        throw new AuthorityGenerationError("incompatible-generation", envelope.generationId);
      }
      if (envelope.predecessorId) {
        if (!byId.has(envelope.predecessorId)) throw new AuthorityGenerationError("broken-lineage");
        children.set(envelope.predecessorId, (children.get(envelope.predecessorId) ?? 0) + 1);
      }
    }
    if ([...children.values()].some(count => count > 1)) throw new AuthorityGenerationError("forked-lineage");
    const roots = candidates.filter(candidate => candidate.envelope.predecessorId === null);
    if (roots.length !== 1) throw new AuthorityGenerationError("broken-lineage");
    const selected = candidates.reduce((newest, candidate) =>
      candidate.envelope.activationIndex > newest.envelope.activationIndex ? candidate : newest,
    );
    let visited = 0;
    let cursor: Candidate | undefined = selected;
    while (cursor) {
      visited += 1;
      cursor = cursor.envelope.predecessorId ? byId.get(cursor.envelope.predecessorId) : undefined;
    }
    if (visited !== candidates.length) throw new AuthorityGenerationError("broken-lineage");
    return selected;
  }

  #validateDirectory(directory: string): Candidate {
    try {
      const envelope = envelopeSchema.parse(JSON.parse(readFileSync(join(directory, "envelope.json"), "utf8")));
      const directoryName = basename(directory);
      if (
        directoryName !== envelope.generationId &&
        !directoryName.startsWith(`.${envelope.generationId}.`) 
      ) throw new Error("directory identity disagreement");
      for (const digest of envelope.objects) {
        const object = join(this.#objects, digest);
        if (!existsSync(object) || createHash("sha256").update(readFileSync(object)).digest("hex") !== digest) {
          throw new AuthorityGenerationError("absent-closure", digest);
        }
      }
      const db = new DatabaseSync(join(directory, "authority.sqlite"), { readOnly: true });
      try {
        const row = db.prepare("SELECT * FROM authority_generation WHERE singleton=1").get();
        const expected = [envelope.generationId, envelope.predecessorId, envelope.activationIndex,
          envelope.schemaVersion, envelope.formatVersion, envelope.releaseMin, envelope.releaseMax];
        const actual = row && [row.generation_id, row.predecessor_id, row.activation_index,
          row.schema_version, row.format_version, row.release_min, row.release_max];
        if (!actual || expected.some((value, index) => value !== actual[index])) throw new Error("SQLite metadata disagreement");
      } finally { db.close(); }
      return { directory, envelope };
    } catch (error) {
      if (error instanceof AuthorityGenerationError) throw error;
      throw new AuthorityGenerationError("invalid-generation", `${basename(directory)}: ${String(error)}`);
    }
  }

  #repairSelector(generationId: string): void {
    replaceRebuildableFile({
      target: join(this.#root, "Generation"),
      materialize: stage => writeFileSync(stage, `${generationId}\n`),
      validate: candidate => readFileSync(candidate, "utf8") === `${generationId}\n`,
    });
  }
}

function releaseWithin(release: string, minimum: string, maximum: string): boolean {
  const parts = (value: string) => value.split(".").map(Number);
  const compare = (left: number[], right: number[]) => {
    for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index]! - right[index]!;
    return 0;
  };
  const current = parts(release);
  return compare(current, parts(minimum)) >= 0 && compare(current, parts(maximum)) <= 0;
}
