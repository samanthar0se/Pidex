import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { adaptersFor } from "../packages/adapters/src/index.js";
import {
  createDeterministicPublicationAdapter,
  publishImmutableFile,
  publishValidatedTree,
  replaceRebuildableFile,
  writeCandidate,
  type PublicationRequest,
  type PublicationStep,
} from "../packages/durability/src/index.js";
import type { AuthorityGenerationEnvelope } from "../packages/host/src/authority-generations.js";
import { recoverProductionAuthority } from "../packages/host/src/production-recovery.js";
import { AuthorityStore } from "../packages/host/src/store.js";

type PublicationOperation = "immutable" | "tree" | "replace";
type NamespaceImage = "old" | "new";

const PUBLICATION_OPERATIONS: PublicationOperation[] = [
  "immutable",
  "tree",
  "replace",
];
const PUBLICATION_CUTS: PublicationStep[] = [
  "stage-created",
  "materialized",
  "validated-before-publication",
  "regular-files-flushed",
  "writers-closed",
  "published",
  "validated-after-publication",
  "parent-directory-flushed",
];
const NAMESPACE_IMAGES: NamespaceImage[] = ["old", "new"];

test("the persistence oracle sends every publication cut and allowed image through fresh production recovery", async () => {
  for (const operation of PUBLICATION_OPERATIONS) {
    for (const cut of PUBLICATION_CUTS) {
      await observeRealPublicationCut(operation, cut);
      // A successful data fence does not imply that the namespace is new.
      // Conversely, publication may be visible before its final fence. These
      // are the two portable images permitted at every named crash cut.
      for (const namespaceImage of NAMESPACE_IMAGES) {
        await witnessImage(namespaceImage, `${operation}:${cut}`);
      }
    }
  }
});

test("the oracle covers FULL WAL reconciliation and continuity-rotating fallback retention", async () => {
  const root = await makeBase("wal-fallback");
  try {
    const firstDb = join(root, "generations", "g1", "authority.sqlite");
    const settings = new DatabaseSync(firstDb, { readOnly: true });
    assert.equal(
      settings.prepare("PRAGMA journal_mode").get()?.journal_mode,
      "wal",
    );
    assert.equal(settings.prepare("PRAGMA synchronous").get()?.synchronous, 2);
    settings.close();

    const damaged = envelope("g2", 2, "g1", "continuity-1", ["missing"]);
    mkdirSync(join(root, "generations", "g2"));
    writeFileSync(
      join(root, "generations", "g2", "envelope.json"),
      JSON.stringify(damaged),
    );
    writeFileSync(
      join(root, "generations", "g2", "failed-evidence"),
      "preserve me",
    );

    const recovered = recoverProductionAuthority(
      root,
      adaptersFor("deterministic"),
      9,
    );
    assert.equal(recovered.kind, "selected");
    if (recovered.kind !== "selected") {
      return;
    }
    assert.equal(recovered.warning?.failedGeneration, "g2");
    assert.notEqual(recovered.generation.continuity, "continuity-1");
    assert.equal(
      existsSync(join(root, "generations", "g2", "failed-evidence")),
      true,
    );
    const repairedSelector = JSON.parse(
      readFileSync(join(root, "Generation"), "utf8"),
    );
    assert.equal(
      repairedSelector.generationId,
      recovered.generation.generationId,
    );

    // A later scan still cannot collect selected, predecessor, failed evidence,
    // or anything in their reference closures.
    const { AuthorityGenerationStore } = await import(
      "../packages/host/src/authority-generations.js"
    );
    const retention = new AuthorityGenerationStore(root);
    retention.resolve();
    retention.resolve();
    assert.throws(() => retention.cleanup(), /ambiguous generation evidence/);
    assert.equal(existsSync(join(root, "generations", "g1")), true);
    assert.equal(existsSync(join(root, "generations", "g2")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function observeRealPublicationCut(
  operation: PublicationOperation,
  cut: PublicationStep,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pidex-publication-cut-"));
  try {
    const adapter = createDeterministicPublicationAdapter({
      failAt: cut,
      platform: "portable",
    });
    const target = join(root, operation);
    const request = createPublicationRequest(operation, target);
    const publish = publicationFunction(operation);
    assert.throws(() => publish(request, adapter), new RegExp(cut));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createPublicationRequest(
  operation: PublicationOperation,
  target: string,
): PublicationRequest {
  if (operation === "tree") {
    return {
      target,
      materialize: stage => {
        writeFileSync(join(stage, "value"), "new");
      },
      validate: () => true,
    };
  }

  return {
    target,
    materialize: writeCandidate("new"),
    validate: () => true,
  };
}

function publicationFunction(
  operation: PublicationOperation,
): typeof publishImmutableFile {
  switch (operation) {
    case "immutable":
      return publishImmutableFile;
    case "tree":
      return publishValidatedTree;
    case "replace":
      return replaceRebuildableFile;
  }
}

async function witnessImage(
  image: NamespaceImage,
  label: string,
): Promise<void> {
  const root = await makeBase(label);
  try {
    if (image === "new") {
      const target = join(root, "generations", "g2");
      cpSync(join(root, "generations", "g1"), target, { recursive: true });
      writeFileSync(
        join(target, "envelope.json"),
        JSON.stringify(envelope("g2", 2, "g1", "continuity-1", [])),
      );
    }
    writeFileSync(join(root, "Generation"), "damaged selector");
    const result = recoverProductionAuthority(
      root,
      adaptersFor("deterministic"),
      8,
    );
    assert.equal(result.kind, "selected");
    if (result.kind === "selected") {
      const expectedGenerationId = image === "new" ? "g2" : "g1";
      assert.equal(result.generation.generationId, expectedGenerationId);
    }
    assert.doesNotThrow(() =>
      JSON.parse(readFileSync(join(root, "Generation"), "utf8")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeBase(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pidex-oracle-"));
  const directory = join(root, "generations", "g1");
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(root, "objects"), { recursive: true });
  const store = new AuthorityStore(
    join(directory, "authority.sqlite"),
    adaptersFor("deterministic"),
  );
  const session = store.createSession(null, null, 1).session;
  store.submitRun(
    "device",
    {
      commandId: label,
      sessionId: session.sessionId,
      prompt: label,
      requiredCapability: "run.submit",
    },
    2,
  );
  store.close();
  writeFileSync(
    join(directory, "envelope.json"),
    JSON.stringify(envelope("g1", 1, null, "continuity-1", [])),
  );
  return root;
}

function envelope(
  generationId: string,
  activationIndex: number,
  predecessor: string | null,
  continuity: string,
  objects: string[],
): AuthorityGenerationEnvelope {
  return {
    formatVersion: 1,
    generationId,
    activationIndex,
    predecessor,
    continuity,
    objects,
    sealed: true,
  };
}
