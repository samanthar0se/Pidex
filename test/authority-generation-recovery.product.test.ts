import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthorityGenerationStore,
  type AuthorityGenerationEnvelope,
} from "../packages/host/src/authority-generations.js";

test("startup falls back by copying authority, rotating continuity, and retaining damage", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-generations-"));
  try {
    await mkdir(join(root, "generations", "generation-1"), { recursive: true });
    await mkdir(join(root, "generations", "generation-2"), { recursive: true });
    await mkdir(join(root, "objects"), { recursive: true });
    await writeFile(join(root, "objects", "good-object"), "authority bytes");
    const first: AuthorityGenerationEnvelope = {
      formatVersion: 1,
      generationId: "generation-1",
      activationIndex: 1,
      predecessor: null,
      continuity: "old-continuity",
      objects: ["good-object"],
      sealed: true,
    };
    const damaged: AuthorityGenerationEnvelope = {
      ...first,
      generationId: "generation-2",
      activationIndex: 2,
      predecessor: first.generationId,
      objects: ["missing-object"],
    };
    await writeFile(
      join(root, "generations", "generation-1", "envelope.json"),
      JSON.stringify(first),
    );
    await writeFile(
      join(root, "generations", "generation-1", "authority.sqlite"),
      "valid database",
    );
    await writeFile(
      join(root, "generations", "generation-2", "envelope.json"),
      JSON.stringify(damaged),
    );
    await writeFile(
      join(root, "generations", "generation-2", "authority.sqlite"),
      "damaged evidence",
    );

    const store = new AuthorityGenerationStore(root);
    const recovery = store.resolve();
    assert.equal(recovery.selected.activationIndex, 3);
    assert.equal(recovery.selected.predecessor, first.generationId);
    assert.notEqual(recovery.selected.continuity, first.continuity);
    assert.equal(recovery.warning?.failedGeneration, damaged.generationId);
    const generationNames = await readdir(join(root, "generations"));
    assert.ok(generationNames.includes("generation-1"));
    assert.ok(generationNames.includes("generation-2"));
    assert.equal(
      await readFile(
        join(root, "generations", "generation-2", "authority.sqlite"),
        "utf8",
      ),
      "damaged evidence",
    );

    const restarted = new AuthorityGenerationStore(root);
    assert.equal(restarted.warnings()[0]?.failedGeneration, damaged.generationId);
    assert.equal(restarted.resolve().selected.generationId, recovery.selected.generationId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("whole-Authority transitions publish and validate a generation before resolver selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-transition-"));
  try {
    await mkdir(join(root, "generations", "source"), { recursive: true });
    await mkdir(join(root, "objects"), { recursive: true });
    await writeFile(join(root, "generations", "source", "authority.sqlite"), "source bytes");
    await writeFile(join(root, "generations", "source", "envelope.json"), JSON.stringify({
      formatVersion: 1, generationId: "source", activationIndex: 1,
      predecessor: null, continuity: "continuity-1", objects: [], sealed: true,
    }));
    const store = new AuthorityGenerationStore(root);
    const result = store.activate({
      sourceGeneration: "source",
      rotateContinuity: true,
      materialize: (stage, source) =>
        writeFileSync(join(stage, "authority.sqlite"), `${source}: migrated`),
      validate: stage =>
        assert.match(readFileSync(join(stage, "authority.sqlite"), "utf8"), /migrated/),
    });
    assert.equal(result.selected.predecessor, "source");
    assert.notEqual(result.selected.continuity, "continuity-1");
    assert.equal(
      JSON.parse(await readFile(join(root, "Generation"), "utf8")).generationId,
      result.selected.generationId,
    );
    assert.equal(await readFile(join(root, "generations", "source", "authority.sqlite"), "utf8"), "source bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup requires later scans and retains selected, predecessor, holds, warnings, and closures", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-retention-"));
  try {
    await mkdir(join(root, "objects"), { recursive: true });
    for (const object of ["old", "predecessor", "selected", "held"]) {
      await writeFile(join(root, "objects", object), object);
    }
    const generations = [
      ["g1", 1, null, "old"],
      ["g2", 2, "g1", "predecessor"],
      ["g3", 3, "g2", "selected"],
      ["g4", 4, "g3", "held"],
    ] as const;
    for (const [id, activationIndex, predecessor, object] of generations) {
      await mkdir(join(root, "generations", id), { recursive: true });
      await writeFile(
        join(root, "generations", id, "envelope.json"),
        JSON.stringify({
          formatVersion: 1,
          generationId: id,
          activationIndex,
          predecessor,
          continuity: "continuity",
          objects: [object],
          sealed: true,
        }),
      );
    }
    const store = new AuthorityGenerationStore(root);
    // Select g4, then hold the old g1 until a second scan confirms the orphans.
    store.resolve();
    store.setHold("g1", true);
    assert.deepEqual(store.cleanup().generations, []);
    store.resolve();
    const cleanup = store.cleanup();
    assert.deepEqual(cleanup.generations, ["g2"]);
    assert.deepEqual((await readdir(join(root, "objects"))).sort(), ["held", "old", "selected"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
