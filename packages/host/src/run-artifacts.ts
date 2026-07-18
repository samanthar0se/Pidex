import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

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
    const directory = this.settlementDirectory();
    mkdirSync(directory, { recursive: true });

    const body = JSON.stringify({ runId, text, checkpoint });
    const evidence = JSON.stringify({ body, digest: sha256(body) });
    const stagedPath = join(directory, `${runId}.${randomUUID()}.stage`);

    writeFileSync(stagedPath, evidence, { flag: "wx" });
    flushPath(stagedPath);
    renameSync(stagedPath, this.completionEvidencePath(runId));
    flushPath(directory);
  }

  readCompletionEvidence(runId: string): CompletionEvidence | null {
    const path = this.completionEvidencePath(runId);
    if (!existsSync(path)) {
      return null;
    }

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

  removeCompletionEvidence(runId: string): void {
    const path = this.completionEvidencePath(runId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  /** Publishes verified bytes before returning their content-addressed ID. */
  publishBlob(bytes: Buffer): string {
    const digest = sha256(bytes);
    const directory = join(this.#dataDir, "blobs");
    const destination = join(directory, digest);
    mkdirSync(directory, { recursive: true });

    if (!existsSync(destination)) {
      const stagedPath = `${destination}.${randomUUID()}.stage`;
      writeFileSync(stagedPath, bytes, { flag: "wx" });
      flushPath(stagedPath);

      if (sha256(readFileSync(stagedPath)) !== digest) {
        unlinkSync(stagedPath);
        throw new Error("blob-verification-failed");
      }

      renameSync(stagedPath, destination);
      flushPath(directory);
    }

    return `sha256:${digest}`;
  }

  readBlob(blobId: string): Buffer | null {
    const digest = /^sha256:([a-f0-9]{64})$/.exec(blobId)?.[1];
    if (!digest) {
      return null;
    }

    const path = join(this.#dataDir, "blobs", digest);
    if (!existsSync(path)) {
      return null;
    }

    const bytes = readFileSync(path);
    if (sha256(bytes) !== digest) {
      throw new Error("blob-verification-failed");
    }
    return bytes;
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

function flushPath(path: string): void {
  const fileDescriptor = openSync(path, "r");
  try {
    fsyncSync(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }
}
