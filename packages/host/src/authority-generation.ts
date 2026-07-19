import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { HostAdapters } from "../../adapters/src/index.js";
import {
  publishValidatedTree,
  replaceRebuildableFile,
} from "../../durability/src/index.js";
import { validateRetainedCertificateIdentity } from "./certificate.js";
import { AuthorityStore, type InitialCatalog } from "./store.js";

const GENERATION_FORMAT_VERSION = 1;
const AUTHORITY_SCHEMA_VERSION = 1;
const INITIAL_ACTIVATION_INDEX = 1;
const CLEANUP_ACTIVATION_INDEX = 2;
const CLEANUP_LINEAGE_LENGTH = 2;
const OBJECT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MIGRATION_FREEZE_CONTENT = "release-m\n";
const LEGACY_TLS_FILES = [
  "pidex-ca.pem",
  "pidex-ca-key.dpapi",
  "host.pem",
  "host-key.dpapi",
];
const generationIdSchema = z.string().regex(/^generation_[0-9a-f-]{36}$/);
const envelopeSchema = z.object({
  generationId: generationIdSchema,
  predecessorId: generationIdSchema.nullable(),
  activationIndex: z.number().int().positive(),
  schemaVersion: z.literal(AUTHORITY_SCHEMA_VERSION),
  formatVersion: z.literal(GENERATION_FORMAT_VERSION),
  releaseMin: z.string().regex(/^\d+\.\d+\.\d+$/),
  releaseMax: z.string().regex(/^\d+\.\d+\.\d+$/),
  objects: z.array(z.string().regex(OBJECT_DIGEST_PATTERN)),
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

export type LegacyCleanupRefusal =
  | "cleanup-generation-missing"
  | "cleanup-proof-missing"
  | "cleanup-proof-stale"
  | "generation-held"
  | "failed-evidence-protected"
  | "tls-continuity-lost";

export class LegacyCleanupRefusalError extends Error {
  constructor(readonly code: LegacyCleanupRefusal, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LegacyCleanupRefusalError";
  }
}

export interface LegacyCleanupProof {
  readonly nonce: string;
  readonly generationIds: readonly string[];
  readonly tlsDigests: Readonly<Record<string, string>>;
}

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

export interface LegacyMigrationOptions {
  /** Retained release B used if release M must be rolled back. */
  bridgeDirectory: string;
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
      if (existsSync(this.#migrationFreezePath())) {
        throw new Error("legacy authority is frozen for migration");
      }
      return new AuthorityStore(
        join(this.#dataDir, "authority.sqlite"),
        this.adapters,
        catalog,
      );
    }

    return this.#openCanonical(catalog);
  }

  /** Offline release-M cutover. The sealed envelope is the one-way marker. */
  async migrateLegacy(options: LegacyMigrationOptions): Promise<void> {
    if (this.#sealedDirectories().length !== 0) {
      // A retry may prove selection, but can never copy legacy over canonical.
      this.#openCanonical({}).close();
      return;
    }
    this.#validateBridge(options.bridgeDirectory);
    this.#validateLegacyIdentityAndTls();

    const legacyPath = join(this.#dataDir, "authority.sqlite");
    if (!existsSync(legacyPath)) {
      throw new AuthorityGenerationError(
        "invalid-generation",
        "legacy authority is missing",
      );
    }
    const source = new DatabaseSync(legacyPath);
    const backupPath = join(
      this.#authorityDirectory,
      `.legacy-backup-${randomUUID()}.sqlite`,
    );
    try {
      const integrity = source.prepare("PRAGMA integrity_check").get();
      if (integrity?.integrity_check !== "ok") {
        throw new AuthorityGenerationError(
          "invalid-generation",
          "legacy database integrity failed",
        );
      }
      // Published before backup: startup cannot reopen legacy after this
      // durable freeze. Release M is invoked only after release B has quiesced.
      replaceRebuildableFile({
        target: this.#migrationFreezePath(),
        materialize: stage => writeFileSync(stage, MIGRATION_FREEZE_CONTENT),
        validate: candidate =>
          readFileSync(candidate, "utf8") === MIGRATION_FREEZE_CONTENT,
      });
      await backup(source, backupPath);
    } finally {
      source.close();
    }

    try {
      const objects = this.#publishLegacyObjects();
      const envelope = this.#createGenesisEnvelope(objects);
      this.#publishGenerationCopy(backupPath, envelope);
      // Work remains closed until the startup-equivalent resolver selects it.
      this.#openCanonical({}).close();
    } finally {
      rmSync(backupPath, { force: true });
    }
  }

  /** Release C advances Authority before any legacy path is considered. */
  createCleanupGeneration(): string {
    const selected = this.#select();
    if (selected.envelope.activationIndex >= CLEANUP_ACTIVATION_INDEX) {
      return selected.envelope.generationId;
    }

    const envelope: AuthorityGenerationEnvelope = {
      ...selected.envelope,
      generationId: `generation_${randomUUID()}`,
      predecessorId: selected.envelope.generationId,
      activationIndex: CLEANUP_ACTIVATION_INDEX,
      releaseMin: this.release,
      releaseMax: this.release,
    };
    this.#publishGenerationCopy(
      join(selected.directory, "authority.sqlite"),
      envelope,
    );
    const supportedReleaseFloor = `${this.release}\n`;
    replaceRebuildableFile({
      target: join(this.#authorityDirectory, "SupportedReleaseFloor"),
      materialize: stage => writeFileSync(stage, supportedReleaseFloor),
      validate: candidate =>
        readFileSync(candidate, "utf8") === supportedReleaseFloor,
    });
    this.#openCanonical({}).close();
    return envelope.generationId;
  }

  /**
   * A distinct startup-equivalent pass creates deletion evidence. Publication
   * itself deliberately cannot return this proof.
   */
  validateLegacyDeletion(): LegacyCleanupProof {
    const selected = this.#select();
    const candidates = this.#sealedDirectories().map(directory =>
      this.#validateDirectory(directory),
    );
    const hasInitialGeneration = candidates.some(
      candidate =>
        candidate.envelope.activationIndex === INITIAL_ACTIVATION_INDEX,
    );
    if (
      candidates.length !== CLEANUP_LINEAGE_LENGTH ||
      selected.envelope.activationIndex !== CLEANUP_ACTIVATION_INDEX ||
      !hasInitialGeneration
    ) {
      throw new LegacyCleanupRefusalError("cleanup-generation-missing");
    }
    for (const candidate of candidates) {
      if (existsSync(join(candidate.directory, "HOLD"))) {
        throw new LegacyCleanupRefusalError(
          "generation-held",
          candidate.envelope.generationId,
        );
      }
      if (
        existsSync(join(candidate.directory, "FAILED")) ||
        existsSync(join(candidate.directory, "RECOVERY-WARNING"))
      ) {
        throw new LegacyCleanupRefusalError(
          "failed-evidence-protected",
          candidate.envelope.generationId,
        );
      }
    }

    const proof: LegacyCleanupProof = {
      nonce: randomUUID(),
      generationIds: candidates
        .map(candidate => candidate.envelope.generationId)
        .sort(),
      tlsDigests: this.#legacyTlsDigests(),
    };
    const serializedProof = JSON.stringify(proof);
    replaceRebuildableFile({
      target: this.#legacyDeletionProofPath(),
      materialize: stage => writeFileSync(stage, serializedProof),
      validate: candidate =>
        readFileSync(candidate, "utf8") === serializedProof,
    });
    return proof;
  }

  deleteLegacy(proof: LegacyCleanupProof): void {
    const proofPath = this.#legacyDeletionProofPath();
    if (!existsSync(proofPath)) {
      throw new LegacyCleanupRefusalError("cleanup-proof-missing");
    }
    const durableProof: unknown = JSON.parse(readFileSync(proofPath, "utf8"));
    const serializedProof = JSON.stringify(proof);
    if (JSON.stringify(durableProof) !== serializedProof) {
      throw new LegacyCleanupRefusalError("cleanup-proof-stale");
    }

    // Re-run all authority, closure, hold and failed-evidence checks at the
    // deletion boundary; a proof is never a lease and age has no meaning.
    const current = this.validateLegacyDeletion();
    const currentGenerationIds = JSON.stringify(current.generationIds);
    const provenGenerationIds = JSON.stringify(proof.generationIds);
    if (currentGenerationIds !== provenGenerationIds) {
      throw new LegacyCleanupRefusalError("cleanup-proof-stale");
    }
    const currentTlsDigests = JSON.stringify(current.tlsDigests);
    const provenTlsDigests = JSON.stringify(proof.tlsDigests);
    if (currentTlsDigests !== provenTlsDigests) {
      throw new LegacyCleanupRefusalError("tls-continuity-lost");
    }

    rmSync(join(this.#dataDir, "authority.sqlite"), { force: true });
    rmSync(join(this.#dataDir, "authority.sqlite-wal"), { force: true });
    rmSync(join(this.#dataDir, "authority.sqlite-shm"), { force: true });
    rmSync(join(this.#dataDir, "blobs"), { recursive: true, force: true });
  }

  #legacyTlsDigests(): Record<string, string> {
    const tlsDirectory = join(this.#dataDir, "tls");
    const digests: Record<string, string> = {};
    if (!existsSync(tlsDirectory)) {
      return digests;
    }
    for (const name of LEGACY_TLS_FILES) {
      const filePath = join(tlsDirectory, name);
      if (!existsSync(filePath)) {
        throw new LegacyCleanupRefusalError("tls-continuity-lost", name);
      }
      digests[name] = createHash("sha256")
        .update(readFileSync(filePath))
        .digest("hex");
    }
    return digests;
  }

  #validateBridge(directory: string): void {
    const manifestPath = join(directory, "release.json");
    if (!existsSync(manifestPath)) {
      throw new Error("compatible bridge release is not retained");
    }

    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      !isRecord(manifest) ||
      manifest.role !== "bridge" ||
      manifest.authorityFormat !== GENERATION_FORMAT_VERSION
    ) {
      throw new Error("retained bridge release is incompatible");
    }
  }

  #validateLegacyIdentityAndTls(): void {
    const identityPath = join(this.#dataDir, "identity.json");
    if (existsSync(identityPath)) {
      const identity: unknown = JSON.parse(readFileSync(identityPath, "utf8"));
      if (
        !isRecord(identity) ||
        identity.schemaVersion !== 1 ||
        typeof identity.hostname !== "string"
      ) {
        throw new Error("installation identity is invalid");
      }
    }

    const tlsDirectory = join(this.#dataDir, "tls");
    if (existsSync(tlsDirectory)) {
      const tlsGenerationsDirectory = join(tlsDirectory, "generations");
      if (existsSync(tlsGenerationsDirectory)) {
        validateRetainedCertificateIdentity(
          this.#dataDir,
          this.adapters.windows,
        );
        return;
      }

      for (const name of LEGACY_TLS_FILES) {
        const path = join(tlsDirectory, name);
        if (!existsSync(path)) {
          throw new Error("TLS identity is incomplete");
        }

        const statistics = statSync(path);
        if (!statistics.isFile() || statistics.size === 0) {
          throw new Error("TLS identity is incomplete");
        }
      }
    }
  }

  #publishLegacyObjects(): string[] {
    const legacyObjects = join(this.#dataDir, "blobs");
    if (!existsSync(legacyObjects)) {
      return [];
    }

    const objects: string[] = [];
    for (const entry of readdirSync(legacyObjects, { withFileTypes: true })) {
      if (!entry.isFile() || !OBJECT_DIGEST_PATTERN.test(entry.name)) {
        throw new AuthorityGenerationError("absent-closure", entry.name);
      }

      const source = join(legacyObjects, entry.name);
      const bytes = readFileSync(source);
      if (createHash("sha256").update(bytes).digest("hex") !== entry.name) {
        throw new AuthorityGenerationError("absent-closure", entry.name);
      }

      const target = join(this.#objectsDirectory, entry.name);
      if (!existsSync(target)) {
        copyFileSync(source, target);
      }
      objects.push(entry.name);
    }
    return objects.sort();
  }

  #migrationFreezePath(): string {
    return join(this.#authorityDirectory, "MIGRATION-FROZEN");
  }

  #legacyDeletionProofPath(): string {
    return join(this.#authorityDirectory, "LegacyDeletionProof");
  }

  #createGenesisEnvelope(objects: string[]): AuthorityGenerationEnvelope {
    return {
      generationId: `generation_${randomUUID()}`,
      predecessorId: null,
      activationIndex: INITIAL_ACTIVATION_INDEX,
      schemaVersion: AUTHORITY_SCHEMA_VERSION,
      formatVersion: GENERATION_FORMAT_VERSION,
      releaseMin: this.release,
      releaseMax: this.release,
      objects,
    };
  }

  #publishGenerationCopy(
    sourceDatabasePath: string,
    envelope: AuthorityGenerationEnvelope,
  ): void {
    publishValidatedTree({
      target: join(this.#generationsDirectory, envelope.generationId),
      materialize: stage => {
        const databasePath = join(stage, "authority.sqlite");
        copyFileSync(sourceDatabasePath, databasePath);
        this.#initializeGeneration(databasePath, envelope);
        this.#writeGenerationMetadata(stage, envelope);
      },
      validate: stage => {
        this.#validateDirectory(stage);
      },
    });
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
    const envelope = this.#createGenesisEnvelope([]);
    publishValidatedTree({
      target: join(this.#generationsDirectory, envelope.generationId),
      materialize: stage => {
        this.#initializeGeneration(
          join(stage, "authority.sqlite"),
          envelope,
          catalog,
        );
        this.#writeGenerationMetadata(stage, envelope);
      },
      validate: stage => {
        this.#validateDirectory(stage);
      },
    });
  }

  #initializeGeneration(
    databasePath: string,
    envelope: AuthorityGenerationEnvelope,
    catalog: InitialCatalog = {},
  ): void {
    const store = new AuthorityStore(databasePath, this.adapters, catalog);
    try {
      store.initializeGeneration(envelope);
    } finally {
      store.close();
    }
  }

  #writeGenerationMetadata(
    directory: string,
    envelope: AuthorityGenerationEnvelope,
  ): void {
    writeFileSync(
      join(directory, "envelope.json"),
      JSON.stringify(envelope),
    );
    // Written last: discovery of this file is the irreversible cutover.
    writeFileSync(join(directory, "SEALED"), "sealed\n");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
