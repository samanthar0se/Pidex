import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";

test("Host reconstructs its selector from sealed Authority generations", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-generations-"));
  try {
    const initial = await startHost({ dataDir, port: 0, adapters: adaptersFor("deterministic") });
    const status = initial.status();
    await initial.close();

    const selector = join(dataDir, "active-generation.json");
    const selected = JSON.parse(await readFile(selector, "utf8"));
    await writeFile(selector, "damaged selector");

    const recovered = await startHost({
      dataDir,
      port: 0,
      adapters: adaptersFor("deterministic"),
    });
    try {
      assert.equal(recovered.status().hostId, status.hostId);
      assert.deepEqual(JSON.parse(await readFile(selector, "utf8")), selected);
    } finally {
      await recovered.close();
    }

    // Missing is equivalent to corrupt: retained authority, rather than the hint, wins.
    await unlink(selector);
    const again = await startHost({
      dataDir,
      port: 0,
      adapters: adaptersFor("deterministic"),
    });
    try {
      assert.equal(again.status().hostId, status.hostId);
    } finally {
      await again.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
