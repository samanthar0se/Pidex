import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseHostCompatibilityRecord,
  PINNED_PI_VERSION,
} from "../packages/launch-manifest/src/index.js";

const recordUrl = new URL(
  "../packages/launch-manifest/host-compatibility.v1.json",
  import.meta.url,
);
const packageUrl = new URL("../package.json", import.meta.url);

async function loadCheckedInRecord() {
  const contents = await readFile(recordUrl, "utf8");
  return parseHostCompatibilityRecord(JSON.parse(contents));
}

test("checked-in compatibility and package dependencies share the exact Pi pin", async () => {
  const record = await loadCheckedInRecord();
  const packageMetadata = JSON.parse(
    await readFile(packageUrl, "utf8"),
  ) as { dependencies: Record<string, string> };

  assert.equal(record.pi.version, PINNED_PI_VERSION);
  assert.deepEqual(
    [
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
    ].map((dependency) => packageMetadata.dependencies[dependency]),
    Array(3).fill(PINNED_PI_VERSION),
  );
  assert.deepEqual(record.nodeLanes.map((lane) => lane.role), [
    "primary",
    "secondary",
  ]);
  assert.equal(new Set(record.nodeLanes.map((lane) => lane.version)).size, 2);
  assert.ok(
    record.nodeLanes.every((lane) =>
      lane.distribution.endsWith(`node-v${lane.version}-win-x64.zip`),
    ),
  );
  assert.deepEqual(record.piArtifactPaths, [
    {
      sourceGeneration: 1,
      targetGeneration: 1,
      converterArtifact: "maintenance",
    },
  ]);
});

test("Host compatibility records reject ABI and Node-API disagreement", async () => {
  const input = structuredClone(await loadCheckedInRecord());
  input.nodeLanes[0].addonAbi = "napi-9";

  assert.throws(() => parseHostCompatibilityRecord(input), /ABI|Node-API/i);
});

test("Host compatibility records require primary and secondary lane ordering", async () => {
  const input = structuredClone(await loadCheckedInRecord());
  input.nodeLanes[0].role = "secondary";
  input.nodeLanes[1].role = "primary";

  assert.throws(() => parseHostCompatibilityRecord(input), /ordered/i);
});
