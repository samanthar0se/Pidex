import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  publishValidatedTree,
  replaceRebuildableFile,
} from "../../durability/src/index.js";

const AUTHORITY_DATABASE_FILE = "authority.sqlite";
const GENERATION_ENVELOPE_FILE = "generation.json";
const GENERATION_SELECTOR_FILE = "active-generation.json";

const envelopeSchema = z.object({
  formatVersion: z.literal(1),
  generationId: z.string().min(1),
  predecessor: z.string().nullable(),
  activationIndex: z.number().int().positive(),
  schemaVersion: z.literal(1),
  minimumRelease: z.literal(1),
  maximumRelease: z.literal(1),
});
export type AuthorityGenerationEnvelope = z.infer<typeof envelopeSchema>;

const METADATA_SCHEMA = `
  CREATE TABLE IF NOT EXISTS authority_generation (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    generation_id TEXT NOT NULL,
    predecessor TEXT,
    activation_index INTEGER NOT NULL,
    schema_version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recovery_warnings (
    warning_id TEXT PRIMARY KEY,
    detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

const AUTHORITY_METADATA_QUERY = [
  "SELECT generation_id, predecessor, activation_index, schema_version",
  "FROM authority_generation WHERE singleton=1",
].join(" ");

/** Owns canonical Authority discovery. The selector is repaired output, never input authority. */
export class AuthorityGenerationStore {
  readonly #generations: string;

  constructor(readonly dataDir: string) {
    this.#generations = join(dataDir, "generations");
    mkdirSync(this.#generations, { recursive: true });
    mkdirSync(join(dataDir, "objects"), { recursive: true });
  }

  resolve(): string {
    if (!this.#hasEnvelopes()) {
      this.#createGenesis();
    }

    const scanned = this.#scan();
    const validCandidates = scanned.filter(candidate => candidate.valid);
    if (validCandidates.length === 0) {
      throw new Error("No valid compatible Authority generation");
    }

    this.#validateLineage(validCandidates);

    let selected = validCandidates.sort(
      (left, right) =>
        right.envelope.activationIndex - left.envelope.activationIndex,
    )[0]!;
    const highestObservedIndex = Math.max(
      ...scanned.map(candidate => candidate.envelope.activationIndex),
    );
    if (highestObservedIndex > selected.envelope.activationIndex) {
      selected = this.#recoverFallback(selected, highestObservedIndex + 1);
    }

    this.#writeSelector(selected.envelope);
    return join(selected.path, AUTHORITY_DATABASE_FILE);
  }

  #validateLineage(candidates: Candidate[]): void {
    const indexes = new Set(
      candidates.map(candidate => candidate.envelope.activationIndex),
    );
    if (indexes.size !== candidates.length) {
      throw new Error("Ambiguous Authority activation index");
    }

    const candidatesById = new Map(
      candidates.map(candidate => [candidate.envelope.generationId, candidate]),
    );
    for (const candidate of candidates) {
      const predecessor = candidate.envelope.predecessor;
      if (predecessor && !candidatesById.has(predecessor)) {
        throw new Error("Broken Authority generation lineage");
      }
    }

    const children = new Map<string, number>();
    for (const candidate of candidates) {
      const predecessor = candidate.envelope.predecessor;
      if (predecessor) {
        children.set(predecessor, (children.get(predecessor) ?? 0) + 1);
      }
    }
    if ([...children.values()].some(count => count > 1)) {
      throw new Error("Forked Authority generation lineage");
    }
  }

  #hasEnvelopes(): boolean {
    return readdirSync(this.#generations).some(name =>
      existsSync(join(this.#generations, name, GENERATION_ENVELOPE_FILE)),
    );
  }

  #createGenesis(): void {
    const legacy = join(this.dataDir, AUTHORITY_DATABASE_FILE);
    const envelope = this.#newEnvelope(null, 1);
    this.#publish(envelope, stage => {
      const database = join(stage, AUTHORITY_DATABASE_FILE);
      if (existsSync(legacy)) {
        copyFileSync(legacy, database);
      }
      const db = new DatabaseSync(database);
      try {
        this.#setMetadata(db, envelope);
      } finally {
        db.close();
      }
    });
  }

  #recoverFallback(source: Candidate, activationIndex: number): Candidate {
    const envelope = this.#newEnvelope(source.envelope.generationId, activationIndex);
    this.#publish(envelope, stage => {
      const database = join(stage, AUTHORITY_DATABASE_FILE);
      copyFileSync(join(source.path, AUTHORITY_DATABASE_FILE), database);
      const db = new DatabaseSync(database);
      try {
        this.#setMetadata(db, envelope);
        // A possible rollback is a continuity break; old cursors must not reconcile.
        try {
          db.prepare("UPDATE host SET epoch=? WHERE singleton=1").run(randomUUID());
        } catch {
          // The Host table does not exist before bootstrap.
        }
        db.prepare("INSERT OR REPLACE INTO recovery_warnings VALUES (?, ?, ?)")
          .run(
            `generation-fallback-${envelope.generationId}`,
            "A damaged Authority generation was retained",
            Date.now(),
          );
      } finally {
        db.close();
      }
    });
    return {
      envelope,
      path: join(this.#generations, envelope.generationId),
      valid: true,
    };
  }

  #publish(
    envelope: AuthorityGenerationEnvelope,
    materializeDatabase: (stage: string) => void,
  ): void {
    const target = join(this.#generations, envelope.generationId);
    publishValidatedTree({
      target,
      materialize: stage => {
        mkdirSync(stage);
        materializeDatabase(stage);
        writeFileSync(
          join(stage, GENERATION_ENVELOPE_FILE),
          JSON.stringify(envelope),
        );
      },
      validate: candidate => this.#validate(candidate, envelope),
    });
  }

  #scan(): Candidate[] {
    const candidates: Candidate[] = [];
    for (const name of readdirSync(this.#generations)) {
      const path = join(this.#generations, name);
      try {
        const envelope = this.#readEnvelope(path);
        candidates.push({
          envelope,
          path,
          valid:
            name === envelope.generationId && this.#validate(path, envelope),
        });
      } catch {
        // Unsealed stages and unsafe metadata are not candidates.
      }
    }
    return candidates;
  }

  #validate(path: string, expected: AuthorityGenerationEnvelope): boolean {
    try {
      const envelope = this.#readEnvelope(path);
      if (JSON.stringify(envelope) !== JSON.stringify(expected)) {
        return false;
      }

      const db = new DatabaseSync(join(path, AUTHORITY_DATABASE_FILE), {
        readOnly: true,
      });
      try {
        const row = db.prepare(AUTHORITY_METADATA_QUERY).get();
        const integrity = db.prepare("PRAGMA integrity_check").get();
        return (
          integrity?.integrity_check === "ok" &&
          row?.generation_id === envelope.generationId &&
          row.predecessor === envelope.predecessor &&
          row.activation_index === envelope.activationIndex &&
          row.schema_version === envelope.schemaVersion
        );
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  #readEnvelope(path: string): AuthorityGenerationEnvelope {
    const serialized = readFileSync(
      join(path, GENERATION_ENVELOPE_FILE),
      "utf8",
    );
    return envelopeSchema.parse(JSON.parse(serialized));
  }

  #setMetadata(db: DatabaseSync, envelope: AuthorityGenerationEnvelope): void {
    db.exec(METADATA_SCHEMA);
    db.prepare("INSERT OR REPLACE INTO authority_generation VALUES (1, ?, ?, ?, ?)")
      .run(
        envelope.generationId,
        envelope.predecessor,
        envelope.activationIndex,
        envelope.schemaVersion,
      );
  }

  #newEnvelope(
    predecessor: string | null,
    activationIndex: number,
  ): AuthorityGenerationEnvelope {
    return {
      formatVersion: 1,
      generationId: `authority-${randomUUID()}`,
      predecessor,
      activationIndex,
      schemaVersion: 1,
      minimumRelease: 1,
      maximumRelease: 1,
    };
  }

  #writeSelector(envelope: AuthorityGenerationEnvelope): void {
    const body = JSON.stringify({
      generationId: envelope.generationId,
      activationIndex: envelope.activationIndex,
    });
    replaceRebuildableFile({
      target: join(this.dataDir, GENERATION_SELECTOR_FILE),
      materialize: stage => writeFileSync(stage, body),
      validate: path => readFileSync(path, "utf8") === body,
    });
  }
}

interface Candidate {
  envelope: AuthorityGenerationEnvelope;
  path: string;
  valid: boolean;
}
