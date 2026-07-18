import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const BUNDLE_FORMAT = "pidex-portable-backup-v1";
const DEFAULT_DELIVERY_CHUNK_BYTES = 64 * 1024;
const MAX_DRAIN_TIMEOUT_MS = 15 * 60 * 1_000;

interface BackupVersions {
  release: string;
  schema: number;
}

interface PortableBackupOptions {
  root: string;
  setMutationAcceptance: (accepting: boolean) => void;
  drain: (request: {
    signal: AbortSignal;
    deadline: number;
  }) => Promise<boolean>;
  drainTimeoutMs?: number;
}

export interface PortableBackupRecord {
  id: string;
  createdAt: number;
  state: "draining" | "aborted" | "complete";
  barrier: string;
  compatibility: BackupVersions;
  bundleHash?: string;
  bundlePath?: string;
  bundleVerification?: "verified";
  delivery: "not-delivered" | "delivered-stream-verified";
  destinationVerification?: "verified";
  failure?: string;
}

interface CreateInput {
  clientId: string;
  passphrase: string;
  barrier: string;
  database: string;
  files: Array<{ bundlePath: string; sourcePath: string }>;
  identity: { hostId: string; certificateAuthority: string };
  versions: BackupVersions;
  now?: number;
}

interface BundleEnvelope {
  format: typeof BUNDLE_FORMAT;
  salt: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

interface BundleContents {
  manifest: Array<{ path: string; bytes: number; sha256: string }>;
  barrier: string;
  versions: BackupVersions;
  files: Record<string, string>;
}

/** Coordinates the exclusive drain and creates self-contained encrypted exports. */
export class PortableBackups {
  readonly #directory: string;
  readonly #exportsDirectory: string;
  readonly #catalogPath: string;
  #activeController?: AbortController;

  constructor(private readonly options: PortableBackupOptions) {
    this.#directory = join(options.root, "portable-backups");
    this.#exportsDirectory = join(this.#directory, "exports");
    this.#catalogPath = join(this.#directory, "operations.json");

    mkdirSync(this.#exportsDirectory, { recursive: true });
    if (!existsSync(this.#catalogPath)) {
      writeFileSync(this.#catalogPath, "[]");
    }
    this.recoverAbandonedOperations();
  }

  async create(
    input: CreateInput,
  ): Promise<PortableBackupRecord & { bundlePath: string }> {
    if (this.#activeController) {
      throw new Error("backup-already-active");
    }
    if (!input.passphrase) {
      throw new Error("backup-passphrase-required");
    }
    for (const file of input.files) {
      assertPortablePath(file.bundlePath);
    }

    const id = `${input.now ?? Date.now()}-${randomUUID()}`;
    const controller = new AbortController();
    this.#activeController = controller;
    this.upsert({
      id,
      createdAt: input.now ?? Date.now(),
      state: "draining",
      barrier: input.barrier,
      compatibility: input.versions,
      delivery: "not-delivered",
    });
    this.options.setMutationAcceptance(false);

    const stagingDirectory = join(this.#directory, `${id}.stage`);
    try {
      await this.drainMutations(controller);

      mkdirSync(stagingDirectory);
      const contents = createBundleContents(input);
      const envelope = await encryptBundle(contents, input.passphrase);
      const stagedBundlePath = join(stagingDirectory, "bundle");
      writeFileSync(stagedBundlePath, JSON.stringify(envelope));

      // Reread the staged bytes so verification is independent of the writer.
      await verifyBundleFile(stagedBundlePath, input.passphrase);

      const bundlePath = join(this.#exportsDirectory, `${id}.pidex-backup`);
      renameSync(stagedBundlePath, bundlePath);
      rmSync(stagingDirectory, { recursive: true, force: true });

      const record: PortableBackupRecord & { bundlePath: string } = {
        id,
        createdAt: input.now ?? Date.now(),
        state: "complete",
        barrier: input.barrier,
        compatibility: input.versions,
        bundleHash: digest(readFileSync(bundlePath)),
        bundlePath,
        bundleVerification: "verified",
        delivery: "not-delivered",
      };
      this.upsert(record);
      return record;
    } catch (error) {
      rmSync(stagingDirectory, { recursive: true, force: true });
      this.patch(id, { state: "aborted", failure: safeFailure(error) });
      throw error;
    } finally {
      this.#activeController = undefined;
      this.options.setMutationAcceptance(true);
    }
  }

  async cancelActive(_requestingClientId: string): Promise<boolean> {
    if (!this.#activeController) {
      return false;
    }
    this.#activeController.abort("cancelled");
    return true;
  }

  async verifyBundle(id: string, passphrase: string): Promise<void> {
    const record = this.requireComplete(id);
    await verifyBundleFile(record.bundlePath!, passphrase);
    this.patch(id, { bundleVerification: "verified" });
  }

  async deliver(
    id: string,
    chunkBytes = DEFAULT_DELIVERY_CHUNK_BYTES,
  ): Promise<PortableBackupRecord> {
    const record = this.requireComplete(id);
    const source = readFileSync(record.bundlePath!);
    const hash = createHash("sha256");

    for (let offset = 0; offset < source.length; offset += chunkBytes) {
      hash.update(source.subarray(offset, offset + chunkBytes));
    }
    if (hash.digest("hex") !== record.bundleHash) {
      throw new Error("interrupted-or-corrupt-transfer");
    }
    return this.patch(id, { delivery: "delivered-stream-verified" });
  }

  async verifyDestination(
    id: string,
    destination: string,
  ): Promise<PortableBackupRecord> {
    const record = this.requireComplete(id);
    if (
      !existsSync(destination) ||
      digest(readFileSync(destination)) !== record.bundleHash
    ) {
      throw new Error("destination-hash-mismatch");
    }
    return this.patch(id, { destinationVerification: "verified" });
  }

  async catalog(): Promise<PortableBackupRecord[]> {
    return this.readCatalog();
  }

  private async drainMutations(controller: AbortController): Promise<void> {
    const timeoutMs = Math.min(
      this.options.drainTimeoutMs ?? MAX_DRAIN_TIMEOUT_MS,
      MAX_DRAIN_TIMEOUT_MS,
    );
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
    let drained: boolean;

    try {
      drained = await this.options.drain({
        signal: controller.signal,
        deadline: Date.now() + timeoutMs,
      });
    } finally {
      clearTimeout(timer);
    }

    if (drained && !controller.signal.aborted) {
      return;
    }
    if (controller.signal.reason === "cancelled") {
      throw new Error("backup-cancelled");
    }
    throw new Error("backup-drain-timeout");
  }

  private recoverAbandonedOperations(): void {
    const records = this.readCatalog();
    let changed = false;

    for (const record of records) {
      if (record.state === "draining") {
        record.state = "aborted";
        record.failure = "daemon-lost-passphrase-discarded";
        changed = true;
      }
    }
    if (changed) {
      this.writeCatalog(records);
    }

    for (const entry of readdirSync(this.#directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith(".stage")) {
        rmSync(join(this.#directory, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
  }

  private requireComplete(id: string): PortableBackupRecord {
    const record = this.readCatalog().find(item => item.id === id);
    if (!record || record.state !== "complete") {
      throw new Error("backup-unavailable");
    }
    return record;
  }

  private readCatalog(): PortableBackupRecord[] {
    return JSON.parse(
      readFileSync(this.#catalogPath, "utf8"),
    ) as PortableBackupRecord[];
  }

  private writeCatalog(records: PortableBackupRecord[]): void {
    writeFileSync(this.#catalogPath, JSON.stringify(records));
  }

  private upsert(record: PortableBackupRecord): void {
    const records = this.readCatalog().filter(item => item.id !== record.id);
    records.push(record);
    this.writeCatalog(records);
  }

  private patch(
    id: string,
    patch: Partial<PortableBackupRecord>,
  ): PortableBackupRecord {
    const records = this.readCatalog();
    const index = records.findIndex(item => item.id === id);
    if (index < 0) {
      throw new Error("backup-unavailable");
    }

    records[index] = { ...records[index]!, ...patch };
    this.writeCatalog(records);
    return records[index]!;
  }
}

function createBundleContents(input: CreateInput): BundleContents {
  const files: Record<string, string> = {
    "authority.sqlite": readFileSync(input.database).toString("base64"),
    "identity/host.json": Buffer.from(JSON.stringify(input.identity)).toString(
      "base64",
    ),
  };
  for (const file of input.files) {
    files[file.bundlePath] = readFileSync(file.sourcePath).toString("base64");
  }

  const manifest = Object.entries(files).map(([path, encoded]) => {
    const bytes = Buffer.from(encoded, "base64");
    return { path, bytes: bytes.length, sha256: digest(bytes) };
  });
  return {
    manifest,
    barrier: input.barrier,
    versions: input.versions,
    files,
  };
}

async function encryptBundle(
  contents: BundleContents,
  passphrase: string,
): Promise<BundleEnvelope> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(contents)),
    cipher.final(),
  ]);

  return {
    format: BUNDLE_FORMAT,
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

async function verifyBundleFile(
  path: string,
  passphrase: string,
): Promise<void> {
  try {
    const envelope = JSON.parse(readFileSync(path, "utf8")) as BundleEnvelope;
    if (envelope.format !== BUNDLE_FORMAT) {
      throw new Error();
    }

    const key = await deriveKey(
      passphrase,
      Buffer.from(envelope.salt, "base64"),
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.nonce, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString();
    const contents = JSON.parse(plaintext) as BundleContents;
    verifyManifest(contents);
  } catch {
    throw new Error("backup-authentication-failed");
  }
}

function verifyManifest(contents: BundleContents): void {
  if (contents.manifest.length !== Object.keys(contents.files).length) {
    throw new Error();
  }

  for (const entry of contents.manifest) {
    const bytes = Buffer.from(contents.files[entry.path] ?? "", "base64");
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) {
      throw new Error();
    }
  }
}

function deriveKey(passphrase: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, 32, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeFailure(error: unknown): string {
  const failure = error instanceof Error ? error.message : "backup-failed";
  if (failure.includes("passphrase")) {
    return "backup-failed";
  }
  return failure;
}

function assertPortablePath(path: string): void {
  const hasParentTraversal = path.includes("..");
  const hasExecutableExtension = /\.(exe|dll|so|dylib|app|msi)$/i.test(path);
  if (path.startsWith("/") || hasParentTraversal || hasExecutableExtension) {
    throw new Error("backup-executables-not-allowed");
  }
}
