import assert from "node:assert/strict";
import test from "node:test";
import {
  authoritativePublisherIds,
  loadPublisherManifest,
  validatePublisherManifest,
  type PublisherManifest,
} from "../packages/durability/src/publisher-manifest.js";

function loadManifestCopy(): PublisherManifest {
  return structuredClone(loadPublisherManifest());
}

test("the checked-in manifest completely describes every authoritative publisher", () => {
  const manifest = loadManifestCopy();
  assert.deepEqual(
    manifest.publishers.map(entry => entry.id),
    [...authoritativePublisherIds],
  );
  assert.doesNotThrow(() => validatePublisherManifest(manifest));
});

test(
  "completeness rejects omitted publishers, boundaries, and protocol steps",
  () => {
    const missingPublisher = loadManifestCopy();
    missingPublisher.publishers.shift();
    assert.throws(
      () => validatePublisherManifest(missingPublisher),
      /publisher is missing/,
    );

    for (const field of [
      "validator",
      "boundary",
      "recovery",
      "acknowledgment",
    ] as const) {
      const incomplete = loadManifestCopy();
      incomplete.publishers[0]![field] = "";
      assert.throws(
        () => validatePublisherManifest(incomplete),
        new RegExp(`missing ${field}`),
      );
    }

    const missingStep = loadManifestCopy();
    missingStep.publishers[0]!.steps = missingStep.publishers[0]!.steps.filter(
      step => step !== "flush-files",
    );
    assert.throws(
      () => validatePublisherManifest(missingStep),
      /missing protocol step flush-files/,
    );
  },
);
