import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test(
  "deterministic development startup prints a pairing URL",
  { timeout: 10_000 },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pidex-development-pairing-"));
    const host = spawn(
      process.execPath,
      ["--import", "tsx", "packages/host/src/main.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PIDEX_ADAPTERS: "deterministic",
          PIDEX_DATA_DIR: dataDir,
          PIDEX_HOSTNAME: "192.0.2.10",
          PIDEX_PORT: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              `Development Host did not print pairing instructions.\n${stdout}${stderr}`,
            ),
          );
        }, 3_000);
        host.stdout.setEncoding("utf8");
        host.stdout.on("data", chunk => {
          stdout += String(chunk);
          if (stdout.includes("Pair this device:")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        host.stderr.setEncoding("utf8");
        host.stderr.on("data", chunk => {
          stderr += String(chunk);
        });
        host.once("error", error => {
          clearTimeout(timeout);
          reject(error);
        });
        host.once("exit", code => {
          clearTimeout(timeout);
          reject(new Error(`Development Host exited with code ${code}`));
        });
      });

      const readyOrigin = stdout.match(
        /Pidex ready at (https:\/\/[^ ]+)/,
      )?.[1];
      const pairingUrl = stdout.match(
        /Pair this device: (https:\/\/[^/]+\/\?pair=[A-Z0-9_-]{20})/,
      )?.[1];

      assert.ok(readyOrigin);
      assert.ok(pairingUrl);
      assert.match(readyOrigin, /^https:\/\/192\.0\.2\.10:\d+$/);
      assert.equal(new URL(pairingUrl).origin, readyOrigin);
    } finally {
      if (host.exitCode === null) {
        const exit = once(host, "exit");
        host.kill("SIGTERM");
        await exit;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
