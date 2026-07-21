import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHostCompatibilityRecord } from "../packages/launch-manifest/src/index.js";

const recordUrl = new URL(
  "../packages/launch-manifest/host-compatibility.v1.json",
  import.meta.url,
);

async function loadCheckedInRecord() {
  const contents = await readFile(recordUrl, "utf8");
  return parseHostCompatibilityRecord(JSON.parse(contents));
}

test("checked-in Host compatibility record pins both exact runtime lanes", async () => {
  const record = await loadCheckedInRecord();

  assert.equal(record.pi.version, "0.80.10");
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
