import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync,
  openSync, readFileSync, renameSync, statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type CorruptionObjectKind =
  | "sqlite" | "blob" | "pi-checkpoint" | "data-generation"
  | "recovery-object" | "recovery-manifest" | "backup-catalog"
  | "host-identity" | "device-authorization";

export interface ScrubCopy {
  path: string;
  /** Identifies an independently managed source, never merely its timestamp. */
  provenance: string;
  /** The cataloged identity of this copy. It must equal the object's identity. */
  digest: string;
}

export interface ScrubObject {
  id: string;
  kind: CorruptionObjectKind;
  path: string;
  digest: string;
  scope: { kind: "global" } | { kind: "session" | "content"; id: string };
  copies: readonly ScrubCopy[];
}

export interface ScrubResult {
  checked: string[];
  repaired: string[];
  isolated: string[];
  bytesChecked: number;
  coverageComplete: boolean;
}

interface ScrubberOptions { recoverySecret?: string; }

/** Incrementally verifies retained bytes and fails closed rather than reconstructing data. */
export class CorruptionScrubber {
  readonly #root: string;
  readonly #objects: readonly ScrubObject[];
  readonly #secret: string;
  #cursor = 0;
  #recovery = false;
  readonly #isolated = new Set<string>();

  constructor(root: string, objects: readonly ScrubObject[], options: ScrubberOptions = {}) {
    this.#root = root;
    this.#objects = [...objects];
    this.#secret = options.recoverySecret ?? randomUUID();
  }

  scrub(input: { now: number; byteBudget: number }): ScrubResult {
    const result: ScrubResult = { checked: [], repaired: [], isolated: [], bytesChecked: 0, coverageComplete: false };
    if (this.#objects.length === 0) return { ...result, coverageComplete: true };

    let visited = 0;
    while (visited < this.#objects.length) {
      const object = this.#objects[this.#cursor]!;
      const size = existsSync(this.resolve(object.path)) ? statSync(this.resolve(object.path)).size : 0;
      if (visited > 0 && result.bytesChecked + size > input.byteBudget) break;
      result.bytesChecked += size;
      result.checked.push(object.id);
      if (!this.valid(object.path, object.digest, object.kind)) this.handleDamage(object, input.now, result);
      this.#cursor = (this.#cursor + 1) % this.#objects.length;
      visited++;
    }
    result.coverageComplete = visited === this.#objects.length;
    return result;
  }

  availability() {
    return this.#recovery
      ? { mode: "recovery" as const, lanService: false, mdns: false, pairedDevicesAccepted: false }
      : { mode: "normal" as const, lanService: true, mdns: true, pairedDevicesAccepted: true };
  }

  createRecoveryLaunchCapability(expiresAt: number): string {
    const body = `pidex-recovery:${expiresAt}`;
    return `${expiresAt}.${createHmac("sha256", this.#secret).update(body).digest("hex")}`;
  }

  authorizeRecoveryLaunch(address: string, capability: string, now = Date.now()): boolean {
    if (!this.#recovery || (address !== "localhost" && address !== "127.0.0.1" && address !== "::1")) return false;
    const [expiryText, signature] = capability.split(".");
    const expiry = Number(expiryText);
    if (!signature || !Number.isFinite(expiry) || now > expiry) return false;
    const expected = createHmac("sha256", this.#secret).update(`pidex-recovery:${expiry}`).digest();
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  private handleDamage(object: ScrubObject, now: number, result: ScrubResult): void {
    // Catalog order and recency carry no authority: every candidate proves exact bytes.
    const copy = object.copies.find(candidate =>
      candidate.digest === object.digest && this.valid(candidate.path, object.digest, object.kind));
    if (copy) {
      const destination = this.resolve(object.path);
      const quarantine = join(this.#root, "quarantine", `${object.id}.${now}.${randomUUID()}`);
      mkdirSync(dirname(destination), { recursive: true });
      const staged = `${destination}.${randomUUID()}.repair`;
      // Materialize and prove the replacement before disturbing live bytes.
      copyFileSync(this.resolve(copy.path), staged);
      if (!this.validAbsolute(staged, object.digest, object.kind)) throw new Error("repair-verification-failed");
      flush(staged);
      mkdirSync(dirname(quarantine), { recursive: true });
      if (existsSync(destination)) renameSync(destination, quarantine);
      renameSync(staged, destination);
      flush(dirname(destination));
      result.repaired.push(object.id);
      this.record({ at: now, object: object.id, action: "repaired", source: copy.provenance, digest: object.digest, quarantine });
      return;
    }

    const scope = object.scope.kind === "global" ? "global" : `${object.scope.kind}:${object.scope.id}`;
    this.#isolated.add(scope);
    if (scope === "global") this.#recovery = true;
    result.isolated.push(scope);
    this.record({ at: now, object: object.id, action: "isolated", scope, reason: "no-proven-exact-copy" });
  }

  private valid(path: string, digest: string, kind: CorruptionObjectKind): boolean {
    return this.validAbsolute(this.resolve(path), digest, kind);
  }

  private validAbsolute(path: string, digest: string, kind: CorruptionObjectKind): boolean {
    if (!existsSync(path)) return false;
    const bytes = readFileSync(path);
    if (createHash("sha256").update(bytes).digest("hex") !== digest) return false;
    if (kind === "sqlite" || kind === "data-generation") {
      try {
        const db = new DatabaseSync(path, { readOnly: true });
        const ok = db.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok"
          && db.prepare("PRAGMA foreign_key_check").all().length === 0;
        db.close();
        return ok;
      } catch { return false; }
    }
    if (kind === "recovery-manifest" || kind === "backup-catalog") {
      try { JSON.parse(bytes.toString("utf8")); } catch { return false; }
    }
    return true;
  }

  private resolve(path: string): string { return join(this.#root, path); }
  private record(value: object): void {
    appendFileSync(join(this.#root, "corruption-diagnostics.jsonl"), `${JSON.stringify(value)}\n`);
  }
}

function flush(path: string): void {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
