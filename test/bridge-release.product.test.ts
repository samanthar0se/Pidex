import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { AuthorityGenerationStore } from "../packages/host/src/authority-generation.js";
import { startHost } from "../packages/host/src/host.js";

function hostIdentity(databasePath: string): { hostId: string; epoch: string } {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database.prepare(
      "SELECT host_id AS hostId, epoch FROM host WHERE singleton=1",
    ).get() as { hostId: string; epoch: string };
    return row;
  } finally {
    database.close();
  }
}

test("bridge release permanently prefers discovered canonical authority", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-bridge-"));
  const adapters = adaptersFor("deterministic");
  try {
    const legacyHost = await startHost({ dataDir, port: 0, adapters });
    const legacyIdentity = legacyHost.status().hostId;
    await legacyHost.close();

    const canonical = new AuthorityGenerationStore(dataDir, "0.1.0", adapters);
    canonical.open().close();
    const generation = (await readFile(
      join(dataDir, "authority", "Generation"),
      "utf8",
    )).trim();
    const canonicalDatabase = join(
      dataDir, "authority", "generations", generation, "authority.sqlite",
    );
    const canonicalIdentity = hostIdentity(canonicalDatabase);
    assert.notEqual(canonicalIdentity.hostId, legacyIdentity);

    // Selection comes from sealed generation discovery, never this hint.
    await unlink(join(dataDir, "authority", "Generation"));
    const bridgeHost = await startHost({ dataDir, port: 0, adapters });
    assert.equal(bridgeHost.status().hostId, canonicalIdentity.hostId);
    bridgeHost.rotateSynchronizationEpoch();
    await bridgeHost.close();

    assert.equal(hostIdentity(join(dataDir, "authority.sqlite")).hostId, legacyIdentity);
    assert.notEqual(hostIdentity(canonicalDatabase).epoch, canonicalIdentity.epoch);

    // A discoverable but damaged canonical generation fails closed; legacy is
    // never reopened as a fallback after the one-way cutover marker exists.
    await writeFile(join(dataDir, "authority", "generations", generation, "envelope.json"), "{}");
    await assert.rejects(startHost({ dataDir, port: 0, adapters }), /invalid-generation/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
