import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  publishImmutableFile,
  writeCandidate,
  type PublicationAdapter,
} from "./index.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const checkpointIdSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .brand<"PiCheckpointId">();
const checkpointManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  sourceCheckpoint: z.string().min(1),
  workerGeneration: z.string().min(1),
  releaseGeneration: z.string().min(1),
  piGeneration: z.string().min(1),
  chunks: z.array(z.strictObject({ sha256: digestSchema, bytes: z.number().int().nonnegative() })).min(1),
  integrity: z.strictObject({ algorithm: z.literal("sha256"), chunksDigest: digestSchema }),
  publicationState: z.literal("published"),
});

export interface PiCheckpointExport {
  sessionId: string;
  sourceCheckpoint: string;
  workerGeneration: string;
  releaseGeneration: string;
  piGeneration: string;
  chunks: readonly Uint8Array[];
}

export type PiCheckpointManifest = z.infer<typeof checkpointManifestSchema>;
export type PiCheckpointId = z.infer<typeof checkpointIdSchema>;

/** Publishes worker-private state as immutable objects and returns only its opaque identity. */
export class PiCheckpointPublisher {
  readonly #root: string;
  readonly #adapter?: PublicationAdapter;

  constructor(root: string, adapter?: PublicationAdapter) {
    this.#root = root;
    this.#adapter = adapter;
  }

  publish(input: PiCheckpointExport): PiCheckpointId {
    if (input.chunks.length === 0) throw new Error("checkpoint-has-no-chunks");
    const chunks = input.chunks.map(chunk => {
      const bytes = Buffer.from(chunk);
      const digest = sha256(bytes);
      publishImmutableFile({
        target: join(this.#root, "chunks", digest),
        materialize: writeCandidate(bytes),
        validate: path => sha256(readFileSync(path)) === digest,
      }, this.#adapter);
      return { sha256: digest, bytes: bytes.byteLength };
    });
    const manifest: PiCheckpointManifest = checkpointManifestSchema.parse({
      schemaVersion: 1,
      sessionId: input.sessionId,
      sourceCheckpoint: input.sourceCheckpoint,
      workerGeneration: input.workerGeneration,
      releaseGeneration: input.releaseGeneration,
      piGeneration: input.piGeneration,
      chunks,
      integrity: {
        algorithm: "sha256",
        chunksDigest: digestChunkList(chunks),
      },
      publicationState: "published",
    });
    const bytes = Buffer.from(JSON.stringify(manifest));
    const digest = sha256(bytes);
    publishImmutableFile({
      target: join(this.#root, "manifests", digest),
      materialize: writeCandidate(bytes),
      validate: path => this.#validateManifest(path, digest),
    }, this.#adapter);
    // Verify the final publication, including every referenced chunk, before
    // permitting Host authority to learn its identity.
    this.#validateManifest(join(this.#root, "manifests", digest), digest);
    return checkpointIdSchema.parse(`sha256:${digest}`);
  }

  #validateManifest(path: string, expectedDigest: string): void {
    const bytes = readFileSync(path);
    if (sha256(bytes) !== expectedDigest) throw new Error("checkpoint-manifest-integrity-failed");
    const manifest = checkpointManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (digestChunkList(manifest.chunks) !== manifest.integrity.chunksDigest) {
      throw new Error("checkpoint-chunk-list-integrity-failed");
    }
    for (const chunk of manifest.chunks) {
      const chunkPath = join(this.#root, "chunks", chunk.sha256);
      if (!existsSync(chunkPath)) throw new Error("checkpoint-chunk-missing");
      const chunkBytes = readFileSync(chunkPath);
      if (chunkBytes.byteLength !== chunk.bytes || sha256(chunkBytes) !== chunk.sha256) {
        throw new Error("checkpoint-chunk-integrity-failed");
      }
    }
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestChunkList(
  chunks: readonly { sha256: string; bytes: number }[],
): string {
  return sha256(Buffer.from(JSON.stringify(chunks)));
}
