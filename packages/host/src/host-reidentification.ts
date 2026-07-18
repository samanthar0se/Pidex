import { createCipheriv, randomBytes, randomUUID, scrypt } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DataGenerationManager } from "./migration.js";

export interface TrustState {
  hostKey: boolean;
  caKey: boolean;
  portableIdentity: boolean;
}

export interface NewHostIdentity {
  hostId: string;
  origin: string;
  ca: string;
}

interface ReidentificationOptions {
  root: string;
  authority: string;
  oldIdentity: { hostId: string; origin: string };
  localhost: () => boolean;
  trust: () => TrustState;
  /** Must validate SQLite integrity and the complete product reference closure. */
  verifyAuthority: () => boolean;
  createVerifiedExport: () => Promise<{ id: string; encrypted: boolean; verified: boolean }>;
  /** Issues a new Host ID, canonical origin, and private CA; it must never reuse old keys. */
  issueIdentity: () => NewHostIdentity;
  /** Invalidates every Device and records the continuity-ending event in the copied authority. */
  reconcile: (authority: DatabaseSync, epoch: string, identity: NewHostIdentity) => void;
  activateTrust: (identity: NewHostIdentity) => void;
}

const CONSEQUENCES = [
  "Reidentify ends old cryptographic continuity; it is not a rotation, restore, clone, or identity-preserving operation.",
  "A new Host identity, canonical origin, private CA, and synchronization epoch will be created.",
  "Every Device authorization and Client cache trust basis becomes invalid; fresh pairing is required.",
];

/** Host-local last resort for verified data whose trust keys cannot be recovered. */
export class HostReidentification {
  #previewed = false;

  constructor(private readonly options: ReidentificationOptions) {}

  preview(input: { localhost: boolean }): { consequences: string[]; confirmation: string } {
    this.requireLocal(input.localhost);
    const trust = this.options.trust();
    if (trust.hostKey && trust.caKey) throw new Error("trust-identity-still-usable");
    if (trust.portableIdentity) throw new Error("portable-identity-restore-required");
    if (!this.options.verifyAuthority()) throw new Error("authority-reference-closure-failed");
    this.#previewed = true;
    return { consequences: [...CONSEQUENCES], confirmation: `END CONTINUITY FOR ${this.options.oldIdentity.hostId}` };
  }

  async commit(confirmation: string): Promise<{
    identity: NewHostIdentity; epoch: string; authority: string; exportId: string;
  }> {
    if (!this.#previewed || confirmation !== `END CONTINUITY FOR ${this.options.oldIdentity.hostId}`) {
      throw new Error("reidentify-confirmation-required");
    }
    this.requireLocal(this.options.localhost());
    const trust = this.options.trust();
    if ((trust.hostKey && trust.caKey) || trust.portableIdentity || !this.options.verifyAuthority()) {
      throw new Error("reidentify-preconditions-changed");
    }

    // Export is deliberately before key issuance or any durable mutation.
    const backup = await this.options.createVerifiedExport();
    if (!backup.encrypted || !backup.verified) throw new Error("verified-encrypted-export-required");

    const identity = this.options.issueIdentity();
    if (identity.hostId === this.options.oldIdentity.hostId || identity.origin === this.options.oldIdentity.origin) {
      throw new Error("new-trust-basis-required");
    }
    const epoch = randomUUID();
    const directory = `reidentified-${randomUUID()}`;
    const generation = join(this.options.root, "generations", directory);
    mkdirSync(generation, { recursive: false });
    const authority = join(generation, "authority.sqlite");
    try {
      copyFileSync(this.options.authority, authority);
      const database = new DatabaseSync(authority);
      try {
        database.exec("BEGIN IMMEDIATE");
        this.options.reconcile(database, epoch, identity);
        database.exec("COMMIT");
        if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("integrity-failed");
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch {}
        throw error;
      } finally { database.close(); }
      this.options.activateTrust(identity);
      new DataGenerationManager(this.options.root).activate({ release: "reidentified", schema: 0, directory });
      this.#previewed = false;
      return { identity, epoch, authority, exportId: backup.id };
    } catch (error) {
      rmSync(generation, { recursive: true, force: true });
      throw error;
    }
  }

  async exportEvidence(input: {
    localhost: boolean; passphrase: string; files: string[];
    manifests: unknown[]; diagnostics: string[];
  }): Promise<{ path: string; label: "NON-RESTORABLE EVIDENCE"; restorable: false }> {
    this.requireLocal(input.localhost);
    if (!input.passphrase) throw new Error("evidence-passphrase-required");
    if (this.options.verifyAuthority()) throw new Error("evidence-only-for-invalid-authority");
    // Files are read whole and fail closed: there is no row-level parsing, repair, or omission.
    const files = input.files.map((path, index) => ({
      name: `${index}-${basename(path)}`,
      bytes: readFileSync(path).toString("base64"),
    }));
    const plaintext = Buffer.from(JSON.stringify({
      label: "NON-RESTORABLE EVIDENCE", restorable: false,
      policy: "exact-files-no-extraction-repair-omission-or-salvage",
      files, manifests: input.manifests, diagnostics: input.diagnostics,
    }));
    const salt = randomBytes(16), nonce = randomBytes(12);
    const key = await deriveKey(input.passphrase, salt);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const path = join(this.options.root, `evidence-${randomUUID()}.pidex-evidence`);
    writeFileSync(path, JSON.stringify({ format: "pidex-non-restorable-evidence-v1", salt: salt.toString("base64"), nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }));
    return { path, label: "NON-RESTORABLE EVIDENCE", restorable: false };
  }

  private requireLocal(localhost: boolean): void {
    if (!localhost || !this.options.localhost()) throw new Error("host-local-recovery-required");
  }
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(passphrase, salt, 32, (error, key) => error ? reject(error) : resolve(key)));
}
