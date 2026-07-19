import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDurabilityPublisher,
  PublicationCollisionError,
  type PublicationStep,
} from "../packages/durability/src/index.js";

test("the durability seam publishes, validates, retries, and preserves collisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-durability-"));
  const steps: PublicationStep[] = [];
  const durability = createDurabilityPublisher({ afterStep: step => steps.push(step) });
  const target = join(root, "object");
  try {
    const request = (body: string) => ({
      target,
      materialize: (path: string) => writeFileSync(path, body),
      validate: (path: string) => readFileSync(path, "utf8").length > 0,
    });
    durability.publishImmutableFile(request("stable"));
    durability.publishImmutableFile(request("stable"));
    assert.equal(await readFile(target, "utf8"), "stable");
    assert.throws(
      () => durability.publishImmutableFile(request("different")),
      PublicationCollisionError,
    );
    assert.equal(await readFile(target, "utf8"), "stable");
    assert.ok((await readdir(root)).some(name => name.endsWith(".stage")));
    assert.ok(steps.includes("files-flushed"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validated trees publish and rebuildable files replace", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-durability-"));
  const durability = createDurabilityPublisher();
  try {
    const selector = join(root, "selector");
    for (const value of ["one", "two"]) {
      durability.replaceRebuildableFile({
        target: selector,
        materialize: path => writeFileSync(path, value),
        validate: path => readFileSync(path, "utf8") === value,
      });
    }
    assert.equal(await readFile(selector, "utf8"), "two");

    durability.publishValidatedTree({
      target: join(root, "tree"),
      materialize: path => {
        mkdirSync(path);
        writeFileSync(join(path, "manifest"), "sealed");
      },
      validate: path => readFileSync(join(path, "manifest"), "utf8") === "sealed",
    });
    assert.equal(await readFile(join(root, "tree", "manifest"), "utf8"), "sealed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
