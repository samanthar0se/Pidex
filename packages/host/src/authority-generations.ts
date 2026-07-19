import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

export interface AuthorityGenerationEnvelope {
  formatVersion: 1;
  generationId: string;
  activationIndex: number;
  predecessor: string | null;
  continuity: string;
  objects: string[];
  sealed: true;
}

export interface RecoveryWarning {
  id: string;
  kind: "authority-fallback";
  failedGeneration: string;
  replacementGeneration: string;
}

export interface GenerationResolution {
  selected: AuthorityGenerationEnvelope;
  warning?: RecoveryWarning;
}

interface ValidationRecord {
  scan: number;
  envelope: AuthorityGenerationEnvelope;
}

/** Owns startup selection and conservative retention for sealed Authority trees. */
export class AuthorityGenerationStore {
  readonly #root: string;
  readonly #generations: string;
  readonly #objects: string;
  readonly #validation = new Map<string, ValidationRecord>();
  #scan = 0;

  constructor(root: string) {
    this.#root = root;
    this.#generations = join(root, "generations");
    this.#objects = join(root, "objects");
    mkdirSync(this.#generations, { recursive: true });
    mkdirSync(this.#objects, { recursive: true });
  }

  /** Startup-equivalent scan. The selector is repaired, never trusted. */
  resolve(): GenerationResolution {
    const scan = this.#scan + 1;
    const candidates = this.#enumerate();
    if (candidates.ambiguous) throw new Error("Ambiguous Authority generation metadata");

    const valid = candidates.envelopes.filter(envelope => this.#isValid(envelope));
    this.#assertCoherent(valid);
    if (valid.length === 0) throw new Error("No valid Authority generation");

    const highestSeen = Math.max(...candidates.envelopes.map(item => item.activationIndex));
    let selected = newest(valid);
    let warning: RecoveryWarning | undefined;
    if (selected.activationIndex < highestSeen) {
      const failed = candidates.envelopes.find(item => item.activationIndex === highestSeen);
      if (!failed || failed.predecessor !== selected.generationId) {
        throw new Error("Unsafe Authority fallback lineage");
      }
      selected = this.#copyForFallback(selected, highestSeen + 1);
      warning = {
        id: `authority-fallback:${failed.generationId}`,
        kind: "authority-fallback",
        failedGeneration: failed.generationId,
        replacementGeneration: selected.generationId,
      };
      this.#writeWarning(warning);
    }

    this.#scan = scan;
    for (const envelope of valid) {
      if (!this.#validation.has(envelope.generationId)) this.#validation.set(envelope.generationId, { scan, envelope });
    }
    if (!this.#validation.has(selected.generationId)) this.#validation.set(selected.generationId, { scan, envelope: selected });
    this.#replaceJson("Generation", { generationId: selected.generationId });
    return { selected, warning };
  }

  warnings(): RecoveryWarning[] {
    const directory = join(this.#root, "warnings");
    if (!existsSync(directory)) return [];
    return readdirSync(directory).map(name =>
      JSON.parse(readFileSync(join(directory, name), "utf8")) as RecoveryWarning,
    );
  }

  clearRecoveryWarning(id: string): void {
    const warning = this.warnings().find(item => item.id === id);
    if (!warning) return;
    rmSync(join(this.#root, "warnings", `${safeFile(id)}.json`), { force: true });
  }

  setHold(generationId: string, held: boolean): void {
    this.#setRetentionMarker("holds", generationId, held);
  }

  setProtected(generationId: string, protectedGeneration: boolean): void {
    this.#setRetentionMarker("protected", generationId, protectedGeneration);
  }

  #setRetentionMarker(kind: "holds" | "protected", generationId: string, enabled: boolean): void {
    if (safeFile(generationId) !== generationId) throw new Error("Unsafe generation identity");
    const path = join(this.#root, kind, generationId);
    if (enabled) {
      mkdirSync(join(this.#root, kind), { recursive: true });
      writeFileSync(path, "held");
    } else rmSync(path, { force: true });
  }

  /**
   * Deletes only candidates proved disposable by an earlier successful scan.
   * Any malformed hold, lineage, closure, or evidence aborts the whole cleanup.
   */
  cleanup(): { generations: string[]; objects: string[] } {
    if (this.#scan === 0) throw new Error("Cleanup requires startup validation");
    const candidates = this.#enumerate();
    if (candidates.ambiguous || candidates.envelopes.some(item => !this.#isValid(item))) {
      throw new Error("Cleanup refused: ambiguous generation evidence");
    }
    this.#assertCoherent(candidates.envelopes);
    const selector = this.#readJson(join(this.#root, "Generation")) as { generationId?: unknown };
    if (typeof selector.generationId !== "string") throw new Error("Cleanup refused: invalid selector");
    const selected = candidates.envelopes.find(item => item.generationId === selector.generationId);
    if (!selected) throw new Error("Cleanup refused: selected generation missing");

    const retained = new Set<string>([selected.generationId]);
    if (selected.predecessor) retained.add(selected.predecessor);
    for (const warning of this.warnings()) retained.add(warning.failedGeneration);
    for (const kind of ["holds", "protected"] as const) {
      const directory = join(this.#root, kind);
      if (existsSync(directory)) for (const id of readdirSync(directory)) retained.add(id);
    }
    for (const id of retained) {
      if (!candidates.envelopes.some(item => item.generationId === id)) {
        throw new Error("Cleanup refused: retained generation missing");
      }
    }

    const generations: string[] = [];
    for (const envelope of candidates.envelopes) {
      const evidence = this.#validation.get(envelope.generationId);
      if (!retained.has(envelope.generationId) && evidence && evidence.scan < this.#scan) {
        rmSync(join(this.#generations, envelope.generationId), { recursive: true });
        generations.push(envelope.generationId);
      }
    }
    const deleted = new Set(generations);
    const pinned = new Set(candidates.envelopes.filter(item => !deleted.has(item.generationId)).flatMap(item => item.objects));
    const objects: string[] = [];
    for (const object of readdirSync(this.#objects)) {
      if (!pinned.has(object)) {
        rmSync(join(this.#objects, object), { recursive: true });
        objects.push(object);
      }
    }
    return { generations, objects };
  }

  #enumerate(): { envelopes: AuthorityGenerationEnvelope[]; ambiguous: boolean } {
    const envelopes: AuthorityGenerationEnvelope[] = [];
    let ambiguous = false;
    const ids = new Set<string>();
    const indexes = new Set<number>();
    for (const name of readdirSync(this.#generations)) {
      try {
        const value = this.#readJson(join(this.#generations, name, "envelope.json"));
        if (!isEnvelope(value) || value.generationId !== name || ids.has(name) || indexes.has(value.activationIndex)) ambiguous = true;
        else {
          ids.add(name); indexes.add(value.activationIndex); envelopes.push(value);
        }
      } catch { ambiguous = true; }
    }
    return { envelopes, ambiguous };
  }

  #isValid(envelope: AuthorityGenerationEnvelope): boolean {
    return envelope.objects.every(object => safeFile(object) === object && existsSync(join(this.#objects, object)));
  }

  #assertCoherent(envelopes: AuthorityGenerationEnvelope[]): void {
    const byId = new Map(envelopes.map(item => [item.generationId, item]));
    for (const envelope of envelopes) {
      if (envelope.predecessor) {
        const predecessor = byId.get(envelope.predecessor);
        if (!predecessor || predecessor.activationIndex >= envelope.activationIndex) throw new Error("Broken Authority lineage");
      }
    }
  }

  #copyForFallback(source: AuthorityGenerationEnvelope, activationIndex: number): AuthorityGenerationEnvelope {
    const generationId = randomUUID();
    const target = join(this.#generations, generationId);
    cpSync(join(this.#generations, source.generationId), target, { recursive: true });
    const envelope = { ...source, generationId, activationIndex, predecessor: source.generationId, continuity: randomUUID() };
    writeFileSync(join(target, "envelope.json"), JSON.stringify(envelope, null, 2));
    return envelope;
  }

  #writeWarning(warning: RecoveryWarning): void {
    mkdirSync(join(this.#root, "warnings"), { recursive: true });
    writeFileSync(join(this.#root, "warnings", `${safeFile(warning.id)}.json`), JSON.stringify(warning, null, 2));
  }

  #replaceJson(name: string, value: unknown): void {
    const stage = join(this.#root, `${name}.new`);
    writeFileSync(stage, JSON.stringify(value));
    rmSync(join(this.#root, name), { force: true });
    writeFileSync(join(this.#root, name), readFileSync(stage));
    rmSync(stage);
  }

  #readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }
}

function newest(items: AuthorityGenerationEnvelope[]): AuthorityGenerationEnvelope {
  return items.reduce((left, right) => left.activationIndex > right.activationIndex ? left : right);
}

function safeFile(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function isEnvelope(value: unknown): value is AuthorityGenerationEnvelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.formatVersion === 1 && typeof item.generationId === "string" && safeFile(item.generationId) === item.generationId &&
    Number.isSafeInteger(item.activationIndex) && Number(item.activationIndex) > 0 &&
    (item.predecessor === null || typeof item.predecessor === "string") && typeof item.continuity === "string" &&
    Array.isArray(item.objects) && item.objects.every(object => typeof object === "string") && item.sealed === true;
}
