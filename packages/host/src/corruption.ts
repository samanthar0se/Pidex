import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { publishImmutableFile } from "../../durability/src/index.js";

export type CorruptionObjectKind =
  | "sqlite"
  | "blob"
  | "pi-checkpoint"
  | "data-generation"
  | "recovery-object"
  | "recovery-manifest"
  | "backup-catalog"
  | "host-identity"
  | "device-authorization";

const LOOPBACK_ADDRESSES = new Set(["localhost", "127.0.0.1", "::1"]);

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

interface ScrubberOptions {
  recoverySecret?: string;
}

/** Incrementally verifies retained bytes and fails closed rather than reconstructing data. */
export class CorruptionScrubber {
  readonly #root: string;
  readonly #objects: readonly ScrubObject[];
  readonly #recoverySecret: string;
  #cursor = 0;
  #inRecoveryMode = false;

  constructor(
    root: string,
    objects: readonly ScrubObject[],
    options: ScrubberOptions = {},
  ) {
    this.#root = root;
    this.#objects = [...objects];
    this.#recoverySecret = options.recoverySecret ?? randomUUID();
  }

  scrub(input: { now: number; byteBudget: number }): ScrubResult {
    const result: ScrubResult = {
      checked: [],
      repaired: [],
      isolated: [],
      bytesChecked: 0,
      coverageComplete: false,
    };
    if (this.#objects.length === 0) {
      result.coverageComplete = true;
      return result;
    }

    let objectsVisited = 0;
    while (objectsVisited < this.#objects.length) {
      const object = this.#objects[this.#cursor]!;
      const objectPath = this.resolvePath(object.path);
      const objectSize = existsSync(objectPath) ? statSync(objectPath).size : 0;
      if (
        objectsVisited > 0 &&
        result.bytesChecked + objectSize > input.byteBudget
      ) {
        break;
      }

      result.bytesChecked += objectSize;
      result.checked.push(object.id);
      if (!this.isValid(object.path, object.digest, object.kind)) {
        this.handleDamage(object, input.now, result);
      }
      this.#cursor = (this.#cursor + 1) % this.#objects.length;
      objectsVisited += 1;
    }
    result.coverageComplete = objectsVisited === this.#objects.length;
    return result;
  }

  availability() {
    if (this.#inRecoveryMode) {
      return {
        mode: "recovery" as const,
        lanService: false,
        mdns: false,
        pairedDevicesAccepted: false,
      };
    }

    return {
      mode: "normal" as const,
      lanService: true,
      mdns: true,
      pairedDevicesAccepted: true,
    };
  }

  createRecoveryLaunchCapability(expiresAt: number): string {
    return `${expiresAt}.${this.recoverySignature(expiresAt).toString("hex")}`;
  }

  authorizeRecoveryLaunch(
    address: string,
    capability: string,
    now = Date.now(),
  ): boolean {
    if (!this.#inRecoveryMode || !LOOPBACK_ADDRESSES.has(address)) {
      return false;
    }

    const [expiryText, signature] = capability.split(".");
    const expiry = Number(expiryText);
    if (!signature || !Number.isFinite(expiry) || now > expiry) {
      return false;
    }

    const expected = this.recoverySignature(expiry);
    const supplied = Buffer.from(signature, "hex");
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }

  private handleDamage(
    object: ScrubObject,
    now: number,
    result: ScrubResult,
  ): void {
    // Catalog order and recency carry no authority: every candidate proves exact bytes.
    const copy = object.copies.find(candidate =>
      this.isProvenCopy(object, candidate),
    );
    if (copy) {
      this.repairFromCopy(object, copy, now, result);
      return;
    }

    const scope =
      object.scope.kind === "global"
        ? "global"
        : `${object.scope.kind}:${object.scope.id}`;
    if (object.scope.kind === "global") {
      this.#inRecoveryMode = true;
    }
    result.isolated.push(scope);
    this.recordDiagnostic({
      at: now,
      object: object.id,
      action: "isolated",
      scope,
      reason: "no-proven-exact-copy",
    });
  }

  private repairFromCopy(
    object: ScrubObject,
    copy: ScrubCopy,
    now: number,
    result: ScrubResult,
  ): void {
    const destination = this.resolvePath(object.path);
    const quarantine = join(
      this.#root,
      "quarantine",
      `${object.id}.${now}.${randomUUID()}`,
    );
    mkdirSync(dirname(destination), { recursive: true });
    mkdirSync(dirname(quarantine), { recursive: true });
    if (existsSync(destination)) {
      renameSync(destination, quarantine);
    }
    // Damage remains immutable evidence; the shared publisher owns staging,
    // validation, flush, and publication of the proven byte-identical copy.
    publishImmutableFile({
      target: destination,
      materialize: stage => copyFileSync(this.resolvePath(copy.path), stage),
      validate: candidate =>
        this.isValidAbsolute(candidate, object.digest, object.kind),
    });

    result.repaired.push(object.id);
    this.recordDiagnostic({
      at: now,
      object: object.id,
      action: "repaired",
      source: copy.provenance,
      digest: object.digest,
      quarantine,
    });
  }

  private isProvenCopy(object: ScrubObject, copy: ScrubCopy): boolean {
    return (
      copy.provenance.trim().length > 0 &&
      copy.path !== object.path &&
      copy.digest === object.digest &&
      this.isValid(copy.path, object.digest, object.kind)
    );
  }

  private isValid(
    path: string,
    digest: string,
    kind: CorruptionObjectKind,
  ): boolean {
    return this.isValidAbsolute(this.resolvePath(path), digest, kind);
  }

  private isValidAbsolute(
    path: string,
    digest: string,
    kind: CorruptionObjectKind,
  ): boolean {
    if (!existsSync(path)) {
      return false;
    }

    const bytes = readFileSync(path);
    if (createHash("sha256").update(bytes).digest("hex") !== digest) {
      return false;
    }

    if (kind === "sqlite" || kind === "data-generation") {
      return hasValidDatabaseIntegrity(path);
    }
    if (kind === "recovery-manifest" || kind === "backup-catalog") {
      try {
        JSON.parse(bytes.toString("utf8"));
      } catch {
        return false;
      }
    }
    return true;
  }

  private recoverySignature(expiresAt: number): Buffer {
    return createHmac("sha256", this.#recoverySecret)
      .update(`pidex-recovery:${expiresAt}`)
      .digest();
  }

  private resolvePath(path: string): string {
    return join(this.#root, path);
  }

  private recordDiagnostic(value: object): void {
    appendFileSync(
      join(this.#root, "corruption-diagnostics.jsonl"),
      `${JSON.stringify(value)}\n`,
    );
  }
}

function hasValidDatabaseIntegrity(path: string): boolean {
  try {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return (
        database.prepare("PRAGMA integrity_check").get()?.integrity_check ===
          "ok" &&
        database.prepare("PRAGMA foreign_key_check").all().length === 0
      );
    } finally {
      database.close();
    }
  } catch {
    return false;
  }
}
