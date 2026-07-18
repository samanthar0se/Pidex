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

test("global authority corruption enters capability-gated local recovery", async () => {
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
      { recoverySecret: "signed-cli-secret" },
    );
    scrubber.scrub({ now: 1, byteBudget: Infinity });
    assert.deepEqual(scrubber.availability(), {
      mode: "recovery",
      lanService: false,
      mdns: false,
      pairedDevicesAccepted: false,
    });
    assert.equal(scrubber.authorizeRecoveryLaunch("localhost", "wrong"), false);
    const capability = scrubber.createRecoveryLaunchCapability(10);
    assert.equal(scrubber.authorizeRecoveryLaunch("localhost", capability, 10), true);
    assert.equal(scrubber.authorizeRecoveryLaunch("localhost", capability, 11), false);
    assert.equal(
      scrubber.authorizeRecoveryLaunch("192.168.1.2", capability, 10),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
