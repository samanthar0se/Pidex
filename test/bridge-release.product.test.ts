import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
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
    ).get();
    if (
      !row ||
      typeof row.hostId !== "string" ||
      typeof row.epoch !== "string"
    ) {
      throw new Error("Host identity is missing or invalid");
    }
    return { hostId: row.hostId, epoch: row.epoch };
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

    assert.equal(
      hostIdentity(join(dataDir, "authority.sqlite")).hostId,
      legacyIdentity,
    );
    assert.notEqual(
      hostIdentity(canonicalDatabase).epoch,
      canonicalIdentity.epoch,
    );

    // A discoverable but damaged canonical generation fails closed; legacy is
    // never reopened as a fallback after the one-way cutover marker exists.
    await writeFile(
      join(
        dataDir,
        "authority",
        "generations",
        generation,
        "envelope.json",
      ),
      "{}",
    );
    await assert.rejects(
      startHost({ dataDir, port: 0, adapters }),
      /invalid-generation/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("migration release freezes legacy and publishes it as canonical genesis before reopening", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-migration-"));
  const adapters = adaptersFor("deterministic");
  try {
    const legacyHost = await startHost({ dataDir, port: 0, adapters });
    await legacyHost.close();
    const legacyDatabase = join(dataDir, "authority.sqlite");
    const legacyAuthorityIdentity = hostIdentity(legacyDatabase);

    const bridgeDirectory = join(dataDir, "releases", "bridge-0.1.0");
    await mkdir(bridgeDirectory, { recursive: true });
    await writeFile(
      join(bridgeDirectory, "release.json"),
      JSON.stringify({
        role: "bridge",
        release: "0.1.0",
        authorityFormat: 1,
      }),
    );

    const canonical = new AuthorityGenerationStore(dataDir, "0.1.0", adapters);
    await canonical.migrateLegacy({ bridgeDirectory });
    assert.equal(
      await readFile(join(dataDir, "authority", "MIGRATION-FROZEN"), "utf8"),
      "release-m\n",
    );
    const generationId = (
      await readFile(join(dataDir, "authority", "Generation"), "utf8")
    ).trim();
    const canonicalDatabase = join(
      dataDir,
      "authority",
      "generations",
      generationId,
      "authority.sqlite",
    );
    assert.deepEqual(
      hostIdentity(canonicalDatabase),
      legacyAuthorityIdentity,
    );

    const migratedHost = await startHost({ dataDir, port: 0, adapters });
    migratedHost.rotateSynchronizationEpoch();
    await migratedHost.close();
    const migratedAuthorityIdentity = hostIdentity(canonicalDatabase);
    assert.notEqual(
      migratedAuthorityIdentity.epoch,
      legacyAuthorityIdentity.epoch,
    );
    assert.deepEqual(hostIdentity(legacyDatabase), legacyAuthorityIdentity);

    await canonical.migrateLegacy({ bridgeDirectory });
    assert.deepEqual(
      hostIdentity(canonicalDatabase),
      migratedAuthorityIdentity,
    );

    // Rollback to B still resolves canonical and cannot mutate legacy.
    const rollbackBridge = await startHost({ dataDir, port: 0, adapters });
    assert.equal(
      rollbackBridge.status().hostId,
      legacyAuthorityIdentity.hostId,
    );
    await rollbackBridge.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("bridge release refuses frozen legacy authority before canonical publication", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-frozen-migration-"));
  try {
    const bridge = new AuthorityGenerationStore(
      dataDir,
      "0.1.0",
      adaptersFor("deterministic"),
    );
    bridge.openBridge().close();
    await writeFile(
      join(dataDir, "authority", "MIGRATION-FROZEN"),
      "release-m\n",
    );

    assert.throws(
      () => bridge.openBridge(),
      /legacy authority is frozen for migration/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
