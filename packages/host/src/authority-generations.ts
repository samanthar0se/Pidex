import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { publishValidatedTree, replaceRebuildableFile } from "../../durability/src/index.js";

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
   singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation_id TEXT NOT NULL,
   predecessor TEXT, activation_index INTEGER NOT NULL, schema_version INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS recovery_warnings (
   warning_id TEXT PRIMARY KEY, detail TEXT NOT NULL, created_at INTEGER NOT NULL
 );`;

/** Owns canonical Authority discovery. The selector is repaired output, never input authority. */
export class AuthorityGenerationStore {
  readonly #root: string;
  readonly #generations: string;

  constructor(readonly dataDir: string) {
    this.#root = dataDir;
    this.#generations = join(dataDir, "generations");
    mkdirSync(this.#generations, { recursive: true });
    mkdirSync(join(dataDir, "objects"), { recursive: true });
  }

  resolve(): string {
    if (!this.#hasEnvelopes()) this.#createGenesis();
    const scanned = this.#scan();
    const valid = scanned.filter(item => item.valid);
    if (!valid.length) throw new Error("No valid compatible Authority generation");
    const indexes = new Set(valid.map(item => item.envelope.activationIndex));
    if (indexes.size !== valid.length) throw new Error("Ambiguous Authority activation index");

    const byId = new Map(valid.map(item => [item.envelope.generationId, item]));
    for (const item of valid) {
      const predecessor = item.envelope.predecessor;
      if (predecessor && !byId.has(predecessor)) throw new Error("Broken Authority generation lineage");
    }
    const children = new Map<string, number>();
    for (const item of valid) if (item.envelope.predecessor) {
      children.set(item.envelope.predecessor, (children.get(item.envelope.predecessor) ?? 0) + 1);
    }
    if ([...children.values()].some(count => count > 1)) throw new Error("Forked Authority generation lineage");

    let selected = valid.sort((a, b) => b.envelope.activationIndex - a.envelope.activationIndex)[0]!;
    const highestObserved = Math.max(...scanned.map(item => item.envelope.activationIndex));
    if (highestObserved > selected.envelope.activationIndex) {
      selected = this.#recoverFallback(selected, highestObserved + 1);
    }
    this.#writeSelector(selected.envelope);
    return join(selected.path, "authority.sqlite");
  }

  #hasEnvelopes(): boolean {
    return readdirSync(this.#generations).some(name => existsSync(join(this.#generations, name, "generation.json")));
  }

  #createGenesis(): void {
    const legacy = join(this.#root, "authority.sqlite");
    const envelope = this.#newEnvelope(null, 1);
    this.#publish(envelope, stage => {
      const database = join(stage, "authority.sqlite");
      if (existsSync(legacy)) copyFileSync(legacy, database);
      const db = new DatabaseSync(database);
      try { this.#setMetadata(db, envelope); } finally { db.close(); }
    });
  }

  #recoverFallback(source: Candidate, activationIndex: number): Candidate {
    const envelope = this.#newEnvelope(source.envelope.generationId, activationIndex);
    this.#publish(envelope, stage => {
      const database = join(stage, "authority.sqlite");
      copyFileSync(join(source.path, "authority.sqlite"), database);
      const db = new DatabaseSync(database);
      try {
        this.#setMetadata(db, envelope);
        // A possible rollback is a continuity break; old cursors must not reconcile.
        try { db.prepare("UPDATE host SET epoch=? WHERE singleton=1").run(randomUUID()); } catch { /* pre-bootstrap */ }
        db.prepare("INSERT OR REPLACE INTO recovery_warnings VALUES (?, ?, ?)")
          .run(`generation-fallback-${envelope.generationId}`, "A damaged Authority generation was retained", Date.now());
      } finally { db.close(); }
    });
    return { envelope, path: join(this.#generations, envelope.generationId), valid: true };
  }

  #publish(envelope: AuthorityGenerationEnvelope, materializeDb: (stage: string) => void): void {
    const target = join(this.#generations, envelope.generationId);
    publishValidatedTree({
      target,
      materialize: stage => {
        mkdirSync(stage);
        materializeDb(stage);
        writeFileSync(join(stage, "generation.json"), JSON.stringify(envelope));
      },
      validate: candidate => this.#validate(candidate, envelope),
    });
  }

  #scan(): Candidate[] {
    const candidates: Candidate[] = [];
    for (const name of readdirSync(this.#generations)) {
      const path = join(this.#generations, name);
      try {
        const envelope = envelopeSchema.parse(JSON.parse(readFileSync(join(path, "generation.json"), "utf8")));
        candidates.push({ envelope, path, valid: name === envelope.generationId && this.#validate(path, envelope) });
      } catch { /* unsealed stages and unsafe metadata are not candidates */ }
    }
    return candidates;
  }

  #validate(path: string, expected: AuthorityGenerationEnvelope): boolean {
    try {
      const envelope = envelopeSchema.parse(JSON.parse(readFileSync(join(path, "generation.json"), "utf8")));
      if (JSON.stringify(envelope) !== JSON.stringify(expected)) return false;
      const db = new DatabaseSync(join(path, "authority.sqlite"), { readOnly: true });
      try {
        const row = db.prepare("SELECT generation_id, predecessor, activation_index, schema_version FROM authority_generation WHERE singleton=1").get();
        const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
        return integrity.integrity_check === "ok" && row?.generation_id === envelope.generationId &&
          row.predecessor === envelope.predecessor && row.activation_index === envelope.activationIndex &&
          row.schema_version === envelope.schemaVersion;
      } finally { db.close(); }
    } catch { return false; }
  }

  #setMetadata(db: DatabaseSync, envelope: AuthorityGenerationEnvelope): void {
    db.exec(METADATA_SCHEMA);
    db.prepare("INSERT OR REPLACE INTO authority_generation VALUES (1, ?, ?, ?, ?)")
      .run(envelope.generationId, envelope.predecessor, envelope.activationIndex, envelope.schemaVersion);
  }

  #newEnvelope(predecessor: string | null, activationIndex: number): AuthorityGenerationEnvelope {
    return { formatVersion: 1, generationId: `authority-${randomUUID()}`, predecessor,
      activationIndex, schemaVersion: 1, minimumRelease: 1, maximumRelease: 1 };
  }

  #writeSelector(envelope: AuthorityGenerationEnvelope): void {
    const body = JSON.stringify({ generationId: envelope.generationId, activationIndex: envelope.activationIndex });
    replaceRebuildableFile({ target: join(this.#root, "active-generation.json"),
      materialize: stage => writeFileSync(stage, body),
      validate: path => readFileSync(path, "utf8") === body });
  }
}

interface Candidate { envelope: AuthorityGenerationEnvelope; path: string; valid: boolean }
