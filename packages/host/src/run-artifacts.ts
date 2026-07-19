import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  publishImmutableFile,
  writeCandidate,
} from "../../durability/src/index.js";

const completionEvidenceSchema = z.object({
  body: z.string(),
  digest: z.string(),
});

const completionEvidenceBodySchema = z.object({
  runId: z.string(),
  text: z.string(),
  checkpoint: z.string().min(1),
});

type CompletionEvidence = z.infer<typeof completionEvidenceBodySchema>;

const BLOB_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

/** Owns durable files used to prove and publish Run settlements. */
export class RunArtifactStore {
  readonly #dataDir: string;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  stageCompletionEvidence(
    runId: string,
    text: string,
    checkpoint: string,
  ): void {
    const body = JSON.stringify({ runId, text, checkpoint });
    const evidence = JSON.stringify({ body, digest: sha256(body) });
    publishImmutableFile({
      target: this.completionEvidencePath(runId),
      materialize: writeCandidate(evidence),
      validate: candidate => {
        this.validateEvidenceFile(candidate, runId);
      },
    });
  }

  readCompletionEvidence(runId: string): CompletionEvidence | null {
    const path = this.completionEvidencePath(runId);
    if (!existsSync(path)) {
      return null;
    }

    return this.validateEvidenceFile(path, runId);
  }

  removeCompletionEvidence(runId: string): void {
    const path = this.completionEvidencePath(runId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  /** Publishes verified bytes before returning their content-addressed ID. */
  publishBlob(bytes: Buffer): string {
    const digest = sha256(bytes);
    const destination = join(this.blobDirectory(), digest);

    publishImmutableFile({
      target: destination,
      materialize: writeCandidate(bytes),
      validate: candidate => {
        if (sha256(readFileSync(candidate)) !== digest) {
          throw new Error("blob-verification-failed");
        }
      },
    });

    return `sha256:${digest}`;
  }

  readBlob(blobId: string): Buffer | null {
    const digest = /^sha256:([a-f0-9]{64})$/.exec(blobId)?.[1];
    if (!digest) {
      return null;
    }

    const path = join(this.blobDirectory(), digest);
    if (!existsSync(path)) {
      return null;
    }

    const bytes = readFileSync(path);
    if (sha256(bytes) !== digest) {
      throw new Error("blob-verification-failed");
    }
    return bytes;
  }

  /**
   * Lists only ordinary, content-addressed files directly inside the managed root.
   */
  listBlobDigests(): string[] {
    const directory = this.blobDirectory();
    if (!existsSync(directory)) {
      return [];
    }

    return readdirSync(directory).filter((name) => {
      if (!isBlobDigest(name)) {
        return false;
      }
      return isOrdinaryFile(join(directory, name));
    });
  }

  quarantineBlob(digest: string): boolean {
    if (!isBlobDigest(digest)) {
      return false;
    }

    const source = join(this.blobDirectory(), digest);
    if (!existsSync(source) || !isOrdinaryFile(source)) {
      return false;
    }

    const directory = this.quarantinedBlobDirectory();
    mkdirSync(directory, { recursive: true });
    renameSync(source, join(directory, digest));
    flushPath(directory);
    return true;
  }

  restoreBlob(digest: string): boolean {
    const source = join(this.quarantinedBlobDirectory(), digest);
    if (!isBlobDigest(digest) || !existsSync(source)) {
      return false;
    }

    const directory = this.blobDirectory();
    mkdirSync(directory, { recursive: true });
    renameSync(source, join(directory, digest));
    flushPath(directory);
    return true;
  }

  deleteQuarantinedBlob(digest: string): boolean {
    const path = join(this.quarantinedBlobDirectory(), digest);
    if (!isBlobDigest(digest) || !existsSync(path) || !isOrdinaryFile(path)) {
      return false;
    }

    unlinkSync(path);
    return true;
  }

  private blobDirectory(): string {
    return join(this.#dataDir, "blobs");
  }

  private quarantinedBlobDirectory(): string {
    return join(this.#dataDir, "quarantine", "blobs");
  }

  private validateEvidenceFile(path: string, runId: string): CompletionEvidence {
    const evidence = completionEvidenceSchema.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (sha256(evidence.body) !== evidence.digest) {
      throw new Error("bad-evidence");
    }

    const body = completionEvidenceBodySchema.parse(JSON.parse(evidence.body));
    if (body.runId !== runId) {
      throw new Error("bad-evidence");
    }

    return body;
  }

  private settlementDirectory(): string {
    return join(this.#dataDir, "settlements");
  }

  private completionEvidencePath(runId: string): string {
    return join(this.settlementDirectory(), `${runId}.json`);
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isBlobDigest(value: string): boolean {
  return BLOB_DIGEST_PATTERN.test(value);
}

function isOrdinaryFile(path: string): boolean {
  const stat = lstatSync(path);
  return stat.isFile() && !stat.isSymbolicLink();
}

function flushPath(path: string): void {
  const fileDescriptor = openSync(path, "r");
  try {
    fsyncSync(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }
}
