import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";

const execute = promisify(execFile);
const cli = resolve("packages/cli/src/main.ts");

test("actual anonymous CLI reads status and doctor from an explicit HTTP Host", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-anonymous-cli-"));
  const host = await startHost({
    dataDir,
    port: 0,
    adapters: adaptersFor("deterministic"),
  });

  try {
    const status = await execute(process.execPath, [
      "--import", "tsx", cli, "status", "--host", host.origin, "--json",
    ]);
    const parsedStatus = JSON.parse(status.stdout);
    assert.equal(parsedStatus.hostId, host.status().hostId);
    assert.equal(parsedStatus.readiness, "ready");

    const doctor = await execute(process.execPath, [
      "--import", "tsx", cli, "doctor", "--host", host.origin, "--json",
    ]);
    assert.deepEqual(JSON.parse(doctor.stdout), await host.doctor());
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
