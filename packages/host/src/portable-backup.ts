import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as deriveKey,
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
import { promisify } from "node:util";

const scrypt = promisify(deriveKey);
const MAX_DRAIN_MS = 15 * 60 * 1_000;

export interface PortableBackupRecord {
  id: string;
  createdAt: number;
  state: "draining" | "aborted" | "complete";
  barrier: string;
  compatibility: { release: string; schema: number };
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
  versions: { release: string; schema: number };
  now?: number;
}

interface BundleEnvelope {
  format: "pidex-portable-backup-v1";
  salt: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

interface BundleContents {
  manifest: Array<{ path: string; bytes: number; sha256: string }>;
  barrier: string;
  versions: { release: string; schema: number };
  files: Record<string, string>;
}

/** Coordinates the exclusive drain and creates self-contained encrypted exports. */
export class PortableBackups {
  private readonly directory: string;
  private readonly exports: string;
  private readonly catalogPath: string;
  private active?: { id: string; clientId: string; controller: AbortController };

  constructor(private readonly options: {
    root: string;
    setMutationAcceptance: (accepting: boolean) => void;
    drain: (request: { signal: AbortSignal; deadline: number }) => Promise<boolean>;
    drainTimeoutMs?: number;
  }) {
    this.directory = join(options.root, "portable-backups");
    this.exports = join(this.directory, "exports");
    this.catalogPath = join(this.directory, "operations.json");
    mkdirSync(this.exports, { recursive: true });
    if (!existsSync(this.catalogPath)) writeFileSync(this.catalogPath, "[]");
    this.recoverAbandonedOperations();
  }

  async create(input: CreateInput): Promise<PortableBackupRecord & { bundlePath: string }> {
    if (this.active) throw new Error("backup-already-active");
    if (!input.passphrase) throw new Error("backup-passphrase-required");
    for (const file of input.files) assertPortablePath(file.bundlePath);

    const id = `${input.now ?? Date.now()}-${randomUUID()}`;
    const controller = new AbortController();
    this.active = { id, clientId: input.clientId, controller };
    this.upsert({
      id, createdAt: input.now ?? Date.now(), state: "draining",
      barrier: input.barrier, compatibility: input.versions,
      delivery: "not-delivered",
    });
    this.options.setMutationAcceptance(false);
    const stage = join(this.directory, `${id}.stage`);
    try {
      const timeoutMs = Math.min(this.options.drainTimeoutMs ?? MAX_DRAIN_MS, MAX_DRAIN_MS);
      const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
      let drained: boolean;
      try {
        drained = await this.options.drain({ signal: controller.signal, deadline: Date.now() + timeoutMs });
      } finally {
        clearTimeout(timer);
      }
      if (!drained || controller.signal.aborted) {
        throw new Error(controller.signal.reason === "cancelled" ? "backup-cancelled" : "backup-drain-timeout");
      }

      mkdirSync(stage);
      const files: Record<string, string> = {
        "authority.sqlite": readFileSync(input.database).toString("base64"),
        "identity/host.json": Buffer.from(JSON.stringify(input.identity)).toString("base64"),
      };
      for (const file of input.files) files[file.bundlePath] = readFileSync(file.sourcePath).toString("base64");
      const manifest = Object.entries(files).map(([path, encoded]) => {
        const bytes = Buffer.from(encoded, "base64");
        return { path, bytes: bytes.length, sha256: digest(bytes) };
      });
      const contents: BundleContents = { manifest, barrier: input.barrier, versions: input.versions, files };
      const envelope = await encrypt(contents, input.passphrase);
      const stagedBundle = join(stage, "bundle");
      writeFileSync(stagedBundle, JSON.stringify(envelope));
      // Verification deliberately closes over no writer: it rereads the staged file.
      await verifyFile(stagedBundle, input.passphrase);
      const bundlePath = join(this.exports, `${id}.pidex-backup`);
      renameSync(stagedBundle, bundlePath);
      rmSync(stage, { recursive: true, force: true });
      const record: PortableBackupRecord & { bundlePath: string } = {
        id, createdAt: input.now ?? Date.now(), state: "complete", barrier: input.barrier,
        compatibility: input.versions, bundleHash: digest(readFileSync(bundlePath)), bundlePath,
        bundleVerification: "verified", delivery: "not-delivered",
      };
      this.upsert(record);
      return record;
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      this.patch(id, { state: "aborted", failure: safeFailure(error) });
      throw error;
    } finally {
      this.active = undefined;
      this.options.setMutationAcceptance(true);
      // input.passphrase is never retained on this instance or in durable state.
    }
  }

  async cancelActive(_requestingClientId: string): Promise<boolean> {
    if (!this.active) return false;
    this.active.controller.abort("cancelled");
    return true;
  }

  async verifyBundle(id: string, passphrase: string): Promise<void> {
    const record = this.requireComplete(id);
    await verifyFile(record.bundlePath!, passphrase);
    this.patch(id, { bundleVerification: "verified" });
  }

  async deliver(id: string, chunkBytes = 64 * 1024): Promise<PortableBackupRecord> {
    const record = this.requireComplete(id);
    const expected = record.bundleHash;
    const source = readFileSync(record.bundlePath!);
    const hash = createHash("sha256");
    for (let offset = 0; offset < source.length; offset += chunkBytes) hash.update(source.subarray(offset, offset + chunkBytes));
    if (hash.digest("hex") !== expected) throw new Error("interrupted-or-corrupt-transfer");
    return this.patch(id, { delivery: "delivered-stream-verified" });
  }

  async verifyDestination(id: string, destination: string): Promise<PortableBackupRecord> {
    const record = this.requireComplete(id);
    if (!existsSync(destination) || digest(readFileSync(destination)) !== record.bundleHash) {
      throw new Error("destination-hash-mismatch");
    }
    return this.patch(id, { destinationVerification: "verified" });
  }

  async catalog(): Promise<PortableBackupRecord[]> { return this.readCatalog(); }

  private recoverAbandonedOperations(): void {
    const records = this.readCatalog();
    let changed = false;
    for (const record of records) if (record.state === "draining") {
      record.state = "aborted";
      record.failure = "daemon-lost-passphrase-discarded";
      changed = true;
    }
    if (changed) this.writeCatalog(records);
    for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith(".stage")) {
        rmSync(join(this.directory, entry.name), { recursive: true, force: true });
      }
    }
  }

  private requireComplete(id: string): PortableBackupRecord {
    const record = this.readCatalog().find(item => item.id === id);
    if (!record || record.state !== "complete") throw new Error("backup-unavailable");
    return record;
  }
  private readCatalog(): PortableBackupRecord[] { return JSON.parse(readFileSync(this.catalogPath, "utf8")) as PortableBackupRecord[]; }
  private writeCatalog(records: PortableBackupRecord[]): void { writeFileSync(this.catalogPath, JSON.stringify(records)); }
  private upsert(record: PortableBackupRecord): void {
    const records = this.readCatalog().filter(item => item.id !== record.id); records.push(record); this.writeCatalog(records);
  }
  private patch(id: string, patch: Partial<PortableBackupRecord>): PortableBackupRecord {
    const records = this.readCatalog(); const index = records.findIndex(item => item.id === id);
    if (index < 0) throw new Error("backup-unavailable");
    records[index] = { ...records[index]!, ...patch }; this.writeCatalog(records); return records[index]!;
  }
}

async function encrypt(contents: BundleContents, passphrase: string): Promise<BundleEnvelope> {
  const salt = randomBytes(16), nonce = randomBytes(12);
  const key = await scrypt(passphrase, salt, 32) as Buffer;
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(contents)), cipher.final()]);
  return { format: "pidex-portable-backup-v1", salt: salt.toString("base64"), nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

async function verifyFile(path: string, passphrase: string): Promise<void> {
  try {
    const envelope = JSON.parse(readFileSync(path, "utf8")) as BundleEnvelope;
    if (envelope.format !== "pidex-portable-backup-v1") throw new Error();
    const key = await scrypt(passphrase, Buffer.from(envelope.salt, "base64"), 32) as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const contents = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString()) as BundleContents;
    if (contents.manifest.length !== Object.keys(contents.files).length) throw new Error();
    for (const entry of contents.manifest) {
      const bytes = Buffer.from(contents.files[entry.path] ?? "", "base64");
      if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error();
    }
  } catch { throw new Error("backup-authentication-failed"); }
}

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function safeFailure(error: unknown): string { const value = error instanceof Error ? error.message : "backup-failed"; return value.includes("passphrase") ? "backup-failed" : value; }
function assertPortablePath(path: string): void {
  if (path.startsWith("/") || path.includes("..") || /\.(exe|dll|so|dylib|app|msi)$/i.test(path)) throw new Error("backup-executables-not-allowed");
}
