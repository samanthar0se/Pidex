import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PublicationCollisionError,
  createDeterministicPublicationAdapter,
  publishImmutableFile,
  publishValidatedTree,
  replaceRebuildableFile,
  writeCandidate,
  type PublicationStep,
} from "../packages/durability/src/index.js";

function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "pidex-publication-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("immutable publication is validated, flushed, published, and idempotent", () => fixture(root => {
  const steps: PublicationStep[] = [];
  const adapter = createDeterministicPublicationAdapter({ onStep: step => steps.push(step) });
  const request = { target: join(root, "object"), materialize: writeCandidate("value"), validate: (path: string) => readFileSync(path, "utf8") === "value" };
  assert.equal(publishImmutableFile(request, adapter).outcome, "published");
  assert.equal(publishImmutableFile(request, adapter).outcome, "already-published");
  assert.equal(readFileSync(request.target, "utf8"), "value");
  assert.ok(steps.includes("regular-files-flushed"));
  assert.ok(steps.includes("validated-after-publication"));
  assert.equal(readdirSync(root).some(name => name.endsWith(".stage")), false);
}));

test("immutable collision preserves candidate evidence without overwriting authority", () => fixture(root => {
  const target = join(root, "object");
  publishImmutableFile({ target, materialize: writeCandidate("first"), validate: () => true });
  let collision: PublicationCollisionError | undefined;
  try {
    publishImmutableFile({ target, materialize: writeCandidate("second"), validate: () => true });
  } catch (error) { collision = error as PublicationCollisionError; }
  assert.ok(collision instanceof PublicationCollisionError);
  assert.equal(readFileSync(target, "utf8"), "first");
  assert.equal(readFileSync(collision.evidencePath, "utf8"), "second");
}));

test("invalid and flush-failed candidates are cleaned without publication", () => fixture(root => {
  const target = join(root, "object");
  assert.throws(() => publishImmutableFile({ target, materialize: writeCandidate("bad"), validate: () => false }), /validation failed/);
  assert.throws(() => publishImmutableFile(
    { target, materialize: writeCandidate("good"), validate: () => true },
    createDeterministicPublicationAdapter({ failAt: "regular-files-flushed" }),
  ), /Injected/);
  assert.equal(existsSync(target), false);
  assert.deepEqual(readdirSync(root), []);
}));

test("publication rejects a materializer that leaves its writer open", { skip: !existsSync("/proc/self/fd") }, () => fixture(root => {
  let descriptor = -1;
  try {
    assert.throws(() => publishImmutableFile({
      target: join(root, "object"),
      materialize(stage) { descriptor = openSync(stage, "wx+"); writeFileSync(descriptor, "value"); },
      validate: () => true,
    }), /writer open/);
  } finally {
    if (descriptor >= 0) closeSync(descriptor);
  }
}));

test("validated trees flush regular files and rebuildable files replace atomically", () => fixture(root => {
  const tree = join(root, "generation");
  publishValidatedTree({
    target: tree,
    materialize(stage) { mkdirSync(join(stage, "nested")); writeFileSync(join(stage, "nested", "manifest"), "sealed"); },
    validate(path) { return readFileSync(join(path, "nested", "manifest"), "utf8") === "sealed"; },
  });
  const selector = join(root, "Generation");
  replaceRebuildableFile({ target: selector, materialize: writeCandidate("one"), validate: () => true });
  replaceRebuildableFile({ target: selector, materialize: writeCandidate("two"), validate: path => readFileSync(path, "utf8").length > 0 });
  assert.equal(readFileSync(selector, "utf8"), "two");
}));

test("Windows records unsupported directory flush honestly", () => fixture(root => {
  const steps: PublicationStep[] = [];
  publishImmutableFile(
    { target: join(root, "object"), materialize: writeCandidate("value"), validate: () => true },
    createDeterministicPublicationAdapter({ platform: "windows", onStep: step => steps.push(step) }),
  );
  assert.ok(steps.includes("parent-directory-flush-unsupported"));
  assert.equal(steps.includes("parent-directory-flushed"), false);
}));
