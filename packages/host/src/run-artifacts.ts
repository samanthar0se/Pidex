import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
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
    const directory = join(this.#dataDir, "blobs");
    const destination = join(directory, digest);
    mkdirSync(directory, { recursive: true });

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

  private validateEvidenceFile(path: string, runId: string): CompletionEvidence {
    const evidence = completionEvidenceSchema.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (sha256(evidence.body) !== evidence.digest) throw new Error("bad-evidence");
    const body = completionEvidenceBodySchema.parse(JSON.parse(evidence.body));
    if (body.runId !== runId) throw new Error("bad-evidence");
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
