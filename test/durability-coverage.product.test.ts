import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  adaptersFor,
  type StorageClassification,
} from "../packages/adapters/src/index.js";
import type { CoverageDiagnostic } from "../packages/host/src/durability-coverage.js";
import { startHost } from "../packages/host/src/host.js";

test(
  "doctor and support refresh privacy-safe per-role Durability coverage and observe transitions",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pidex-private-host-"));
    const installDir = join(dataDir, "private-install-device-77");
    const piDir = join(dataDir, "private-pi-volume-88");
    const adapters = adaptersFor("deterministic");
    const classifications = new Map<string, StorageClassification>([
      [dataDir, { fileSystem: "NTFS", driveType: "fixed" }],
      [installDir, { fileSystem: "ReFS", driveType: "fixed" }],
    ]);
    let volumeChanged = () => {};
    adapters.windows.classifyStorageRoot = async path => {
      if (path === piDir) {
        return new Promise<StorageClassification>(() => {});
      }
      const result = classifications.get(path);
      if (!result) {
        throw new Error("classification failed");
      }
      return result;
    };
    adapters.windows.observeVolumeChanges = listener => {
      volumeChanged = listener;
      return () => {};
    };
    const diagnostics: CoverageDiagnostic[] = [];

    const host = await startHost({
      dataDir,
      installationDir: installDir,
      piCheckpointDir: piDir,
      adapters,
      coverageRefreshTimeoutMs: 15,
      onDiagnostic: event => diagnostics.push(event),
    });
    try {
      assert.equal(
        host.status().readiness,
        "ready",
        "pending assessment cannot block readiness",
      );
      const doctor = await host.doctor();
      assert.equal(doctor.check, "storage");
      assert.equal(doctor.outcome, "degraded");
      assert.deepEqual(
        doctor.coverage.roles.map(item => [item.role, item.state]),
        [
          ["host-data", "covered"],
          ["installation-release", "outside-boundary"],
          ["pi-checkpoint", "indeterminate"],
        ],
      );
      assert.equal(doctor.coverage.aggregate, "outside-boundary");

      const exported = await host.exportSupport();
      const serialized = JSON.stringify(exported);
      assert.doesNotMatch(
        serialized,
        /private-host|private-install|private-pi|device-77|volume-88/,
      );
      assert.equal(
        diagnostics.length,
        2,
        "steady-state refreshes do not repeat transitions",
      );

      classifications.set(installDir, {
        fileSystem: "NTFS",
        driveType: "fixed",
      });
      volumeChanged();
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(host.status().durability?.aggregate, "indeterminate");
      assert.equal(diagnostics.length, 3);

      const movedRoot = join(dataDir, "moved-root");
      classifications.set(movedRoot, {
        fileSystem: "FAT32",
        driveType: "removable",
      });
      host.updateStorageRoots({ "host-data": movedRoot });
      await host.doctor();
      assert.equal(
        host.status().durability?.roles.find(
          role => role.role === "host-data",
        )?.state,
        "outside-boundary",
      );
    } finally {
      await host.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
