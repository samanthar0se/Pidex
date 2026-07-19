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
import {
  publishValidatedTree,
  replaceRebuildableFile,
} from "../../durability/src/index.js";

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

export interface AuthorityTransition {
  /** The generation whose bytes form the recovery basis. It is never changed. */
  sourceGeneration: string;
  objects?: string[];
  rotateContinuity?: boolean;
  materialize(stagingDirectory: string, sourceDirectory: string): void;
  validate?(stagingDirectory: string): void;
}

interface GenerationCandidates {
  envelopes: AuthorityGenerationEnvelope[];
  ambiguous: boolean;
}

/** Owns startup selection and conservative retention for sealed Authority trees. */
export class AuthorityGenerationStore {
  readonly #root: string;
  readonly #generations: string;
  readonly #objects: string;
  readonly #validationScans = new Map<string, number>();
  #scanNumber = 0;

  constructor(root: string) {
    this.#root = root;
    this.#generations = join(root, "generations");
    this.#objects = join(root, "objects");
    mkdirSync(this.#generations, { recursive: true });
    mkdirSync(this.#objects, { recursive: true });
  }

  /**
   * Publishes a sealed generation for migration, restore, rollback,
   * Reidentify, or whole-Authority repair. Activation succeeds only when the
   * production resolver selects the published generation.
   */
  activate(transition: AuthorityTransition): GenerationResolution {
    const sourceEnvelope = this.resolve().selected;
    if (sourceEnvelope.generationId !== transition.sourceGeneration) {
      throw new Error("Authority transition source is not selected");
    }

    const generationId = randomUUID();
    const sourceDirectory = join(
      this.#generations,
      sourceEnvelope.generationId,
    );
    const envelope: AuthorityGenerationEnvelope = {
      formatVersion: 1,
      generationId,
      activationIndex: sourceEnvelope.activationIndex + 1,
      predecessor: sourceEnvelope.generationId,
      continuity: transition.rotateContinuity
        ? randomUUID()
        : sourceEnvelope.continuity,
      objects: transition.objects ?? sourceEnvelope.objects,
      sealed: true,
    };

    publishValidatedTree({
      target: join(this.#generations, generationId),
      materialize: stagingDirectory => {
        transition.materialize(stagingDirectory, sourceDirectory);
        writeFileSync(
          join(stagingDirectory, "envelope.json"),
          JSON.stringify(envelope, null, 2),
        );
      },
      validate: stagingDirectory => {
        const stagedEnvelope = this.#readJson(
          join(stagingDirectory, "envelope.json"),
        );
        if (
          !isEnvelope(stagedEnvelope) ||
          stagedEnvelope.generationId !== generationId
        ) {
          throw new Error("Invalid Authority transition envelope");
        }
        transition.validate?.(stagingDirectory);
      },
    });

    const resolution = this.resolve();
    if (resolution.selected.generationId !== generationId) {
      throw new Error("Authority transition was not selected");
    }
    return resolution;
  }

  /** Startup-equivalent scan. The selector is repaired, never trusted. */
  resolve(): GenerationResolution {
    const scanNumber = this.#scanNumber + 1;
    const candidates = this.#enumerate();
    if (candidates.ambiguous) {
      throw new Error("Ambiguous Authority generation metadata");
    }

    const validGenerations = candidates.envelopes.filter(envelope =>
      this.#isValid(envelope),
    );
    this.#assertCoherent(validGenerations);
    if (validGenerations.length === 0) {
      throw new Error("No valid Authority generation");
    }

    const highestActivationIndex = Math.max(
      ...candidates.envelopes.map(envelope => envelope.activationIndex),
    );
    let selected = newestGeneration(validGenerations);
    let warning: RecoveryWarning | undefined;
    if (selected.activationIndex < highestActivationIndex) {
      const failedGeneration = candidates.envelopes.find(
        envelope => envelope.activationIndex === highestActivationIndex,
      );
      if (
        !failedGeneration ||
        failedGeneration.predecessor !== selected.generationId
      ) {
        throw new Error("Unsafe Authority fallback lineage");
      }
      selected = this.#copyForFallback(selected, highestActivationIndex + 1);
      warning = {
        id: `authority-fallback:${failedGeneration.generationId}`,
        kind: "authority-fallback",
        failedGeneration: failedGeneration.generationId,
        replacementGeneration: selected.generationId,
      };
      this.#writeWarning(warning);
    }

    this.#scanNumber = scanNumber;
    for (const envelope of validGenerations) {
      if (!this.#validationScans.has(envelope.generationId)) {
        this.#validationScans.set(envelope.generationId, scanNumber);
      }
    }
    if (!this.#validationScans.has(selected.generationId)) {
      this.#validationScans.set(selected.generationId, scanNumber);
    }
    this.#replaceJson("Generation", { generationId: selected.generationId });
    return { selected, warning };
  }

  warnings(): RecoveryWarning[] {
    const directory = join(this.#root, "warnings");
    if (!existsSync(directory)) {
      return [];
    }

    return readdirSync(directory).map(name => {
      const path = join(directory, name);
      return JSON.parse(readFileSync(path, "utf8")) as RecoveryWarning;
    });
  }

  clearRecoveryWarning(id: string): void {
    const warning = this.warnings().find(item => item.id === id);
    if (!warning) {
      return;
    }
    rmSync(join(this.#root, "warnings", `${safeFileName(id)}.json`), {
      force: true,
    });
  }

  setHold(generationId: string, held: boolean): void {
    this.#setRetentionMarker("holds", generationId, held);
  }

  setProtected(generationId: string, protectedGeneration: boolean): void {
    this.#setRetentionMarker("protected", generationId, protectedGeneration);
  }

  #setRetentionMarker(
    kind: "holds" | "protected",
    generationId: string,
    enabled: boolean,
  ): void {
    if (safeFileName(generationId) !== generationId) {
      throw new Error("Unsafe generation identity");
    }

    const path = join(this.#root, kind, generationId);
    if (enabled) {
      mkdirSync(join(this.#root, kind), { recursive: true });
      writeFileSync(path, "held");
    } else {
      rmSync(path, { force: true });
    }
  }

  /**
   * Deletes only candidates proved disposable by an earlier successful scan.
   * Any malformed hold, lineage, closure, or evidence aborts the whole cleanup.
   */
  cleanup(): { generations: string[]; objects: string[] } {
    if (this.#scanNumber === 0) {
      throw new Error("Cleanup requires startup validation");
    }

    const candidates = this.#enumerate();
    const hasInvalidGeneration = candidates.envelopes.some(
      envelope => !this.#isValid(envelope),
    );
    if (candidates.ambiguous || hasInvalidGeneration) {
      throw new Error("Cleanup refused: ambiguous generation evidence");
    }

    this.#assertCoherent(candidates.envelopes);
    const selector = this.#readJson(join(this.#root, "Generation")) as {
      generationId?: unknown;
    };
    if (typeof selector.generationId !== "string") {
      throw new Error("Cleanup refused: invalid selector");
    }
    const selected = candidates.envelopes.find(
      envelope => envelope.generationId === selector.generationId,
    );
    if (!selected) {
      throw new Error("Cleanup refused: selected generation missing");
    }

    const retained = new Set<string>([selected.generationId]);
    if (selected.predecessor) {
      retained.add(selected.predecessor);
    }
    for (const warning of this.warnings()) {
      retained.add(warning.failedGeneration);
    }
    for (const kind of ["holds", "protected"] as const) {
      const directory = join(this.#root, kind);
      if (existsSync(directory)) {
        for (const generationId of readdirSync(directory)) {
          retained.add(generationId);
        }
      }
    }
    for (const generationId of retained) {
      if (
        !candidates.envelopes.some(
          envelope => envelope.generationId === generationId,
        )
      ) {
        throw new Error("Cleanup refused: retained generation missing");
      }
    }

    const generations: string[] = [];
    for (const envelope of candidates.envelopes) {
      const validationScan = this.#validationScans.get(envelope.generationId);
      if (
        !retained.has(envelope.generationId) &&
        validationScan !== undefined &&
        validationScan < this.#scanNumber
      ) {
        rmSync(join(this.#generations, envelope.generationId), {
          recursive: true,
        });
        generations.push(envelope.generationId);
      }
    }

    const deleted = new Set(generations);
    const pinned = new Set(
      candidates.envelopes
        .filter(envelope => !deleted.has(envelope.generationId))
        .flatMap(envelope => envelope.objects),
    );
    const objects: string[] = [];
    for (const object of readdirSync(this.#objects)) {
      if (!pinned.has(object)) {
        rmSync(join(this.#objects, object), { recursive: true });
        objects.push(object);
      }
    }
    return { generations, objects };
  }

  #enumerate(): GenerationCandidates {
    const envelopes: AuthorityGenerationEnvelope[] = [];
    let ambiguous = false;
    const ids = new Set<string>();
    const indexes = new Set<number>();
    for (const name of readdirSync(this.#generations)) {
      try {
        const value = this.#readJson(
          join(this.#generations, name, "envelope.json"),
        );
        if (
          !isEnvelope(value) ||
          value.generationId !== name ||
          ids.has(name) ||
          indexes.has(value.activationIndex)
        ) {
          ambiguous = true;
          continue;
        }

        ids.add(name);
        indexes.add(value.activationIndex);
        envelopes.push(value);
      } catch {
        ambiguous = true;
      }
    }
    return { envelopes, ambiguous };
  }

  #isValid(envelope: AuthorityGenerationEnvelope): boolean {
    return envelope.objects.every(
      object =>
        safeFileName(object) === object &&
        existsSync(join(this.#objects, object)),
    );
  }

  #assertCoherent(envelopes: AuthorityGenerationEnvelope[]): void {
    const byId = new Map(
      envelopes.map(envelope => [envelope.generationId, envelope]),
    );
    for (const envelope of envelopes) {
      if (!envelope.predecessor) {
        continue;
      }

      const predecessor = byId.get(envelope.predecessor);
      if (
        !predecessor ||
        predecessor.activationIndex >= envelope.activationIndex
      ) {
        throw new Error("Broken Authority lineage");
      }
    }
  }

  #copyForFallback(
    source: AuthorityGenerationEnvelope,
    activationIndex: number,
  ): AuthorityGenerationEnvelope {
    const generationId = randomUUID();
    const target = join(this.#generations, generationId);
    cpSync(join(this.#generations, source.generationId), target, {
      recursive: true,
    });
    const envelope: AuthorityGenerationEnvelope = {
      ...source,
      generationId,
      activationIndex,
      predecessor: source.generationId,
      continuity: randomUUID(),
    };
    writeFileSync(
      join(target, "envelope.json"),
      JSON.stringify(envelope, null, 2),
    );
    return envelope;
  }

  #writeWarning(warning: RecoveryWarning): void {
    mkdirSync(join(this.#root, "warnings"), { recursive: true });
    writeFileSync(
      join(this.#root, "warnings", `${safeFileName(warning.id)}.json`),
      JSON.stringify(warning, null, 2),
    );
  }

  #replaceJson(name: string, value: unknown): void {
    replaceRebuildableFile({
      target: join(this.#root, name),
      materialize: stage => writeFileSync(stage, JSON.stringify(value)),
      validate: stage =>
        JSON.stringify(this.#readJson(stage)) === JSON.stringify(value),
    });
  }

  #readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, "utf8"));
  }
}

function newestGeneration(
  generations: AuthorityGenerationEnvelope[],
): AuthorityGenerationEnvelope {
  return generations.reduce((currentNewest, candidate) => {
    if (currentNewest.activationIndex > candidate.activationIndex) {
      return currentNewest;
    }
    return candidate;
  });
}

function safeFileName(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function isEnvelope(value: unknown): value is AuthorityGenerationEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    item.formatVersion === 1 &&
    typeof item.generationId === "string" &&
    safeFileName(item.generationId) === item.generationId &&
    typeof item.activationIndex === "number" &&
    Number.isSafeInteger(item.activationIndex) &&
    item.activationIndex > 0 &&
    (item.predecessor === null || typeof item.predecessor === "string") &&
    typeof item.continuity === "string" &&
    Array.isArray(item.objects) &&
    item.objects.every(object => typeof object === "string") &&
    item.sealed === true
  );
}
