import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CorruptionScrubber } from "../packages/host/src/corruption.js";

const hash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

test("scrubbing repairs only an exact proven copy and isolates unprovable damage", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-scrub-"));
  try {
    await mkdir(join(root, "live"));
    await mkdir(join(root, "backup"));
    await writeFile(join(root, "live", "one"), "broken");
    await writeFile(join(root, "backup", "one"), "exact");
    await writeFile(join(root, "live", "two"), "broken too");
    const scrubber = new CorruptionScrubber(root, [
      {
        id: "blob-one",
        kind: "blob",
        path: "live/one",
        digest: hash("exact"),
        scope: { kind: "session", id: "session-one" },
        copies: [
          {
            path: "backup/one",
            provenance: "offline-backup-7",
            digest: hash("exact"),
          },
        ],
      },
      {
        id: "artifact-two",
        kind: "pi-checkpoint",
        path: "live/two",
        digest: hash("wanted"),
        scope: { kind: "session", id: "session-two" },
        copies: [],
      },
    ]);

    const result = scrubber.scrub({ now: 100, byteBudget: Infinity });
    assert.deepEqual(result.repaired, ["blob-one"]);
    assert.deepEqual(result.isolated, ["session:session-two"]);
    assert.equal(await readFile(join(root, "live", "one"), "utf8"), "exact");
    assert.match(
      await readFile(join(root, "corruption-diagnostics.jsonl"), "utf8"),
      /offline-backup-7/,
    );
    assert.equal(scrubber.availability().lanService, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scrubbing rejects an exact copy without independent provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-scrub-"));
  try {
    await mkdir(join(root, "live"));
    await mkdir(join(root, "backup"));
    await writeFile(join(root, "live", "one"), "broken");
    await writeFile(join(root, "backup", "one"), "exact");
    const scrubber = new CorruptionScrubber(root, [
      {
        id: "blob-one",
        kind: "blob",
        path: "live/one",
        digest: hash("exact"),
        scope: { kind: "session", id: "session-one" },
        copies: [
          {
            path: "backup/one",
            provenance: "  ",
            digest: hash("exact"),
          },
        ],
      },
    ]);

    const result = scrubber.scrub({ now: 100, byteBudget: Infinity });
    assert.deepEqual(result.repaired, []);
    assert.deepEqual(result.isolated, ["session:session-one"]);
    assert.equal(await readFile(join(root, "live", "one"), "utf8"), "broken");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("global authority corruption keeps anonymous diagnostics and restore reachable", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-scrub-"));
  try {
    await writeFile(join(root, "identity"), "corrupt");
    const scrubber = new CorruptionScrubber(
      root,
      [
        {
          id: "host-identity",
          kind: "host-identity",
          path: "identity",
          digest: hash("valid"),
          scope: { kind: "global" },
          copies: [],
        },
      ],
    );
    scrubber.scrub({ now: 1, byteBudget: Infinity });
    assert.deepEqual(scrubber.availability(), {
      mode: "recovery",
      lanService: true,
      mdns: false,
      normalAuthority: false,
      anonymousDiagnostics: true,
      anonymousRestore: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
