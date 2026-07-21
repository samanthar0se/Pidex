import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setupDevelopmentCa } from "../packages/host/src/development-ca.js";

const HOST_STARTUP_TIMEOUT_MS = 10_000;

test(
  "development entry point is explicitly deterministic and ignores generic adapter selection",
  { timeout: HOST_STARTUP_TIMEOUT_MS + 5_000 },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pidex-development-pairing-"));
    const profileRoot = join(dataDir, "profile");
    setupDevelopmentCa({
      profileRoot,
      trustCurrentUserCertificate() {},
    });
    const hostProcess = spawn(
      process.execPath,
      ["--import", "tsx", "packages/host/src/development.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PIDEX_ADAPTERS: "product",
          PIDEX_DATA_DIR: dataDir,
          PIDEX_HOSTNAME: "192.0.2.10",
          PIDEX_PORT: "0",
          PIDEX_DEVELOPMENT_PROFILE_ROOT: profileRoot,
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
        }, HOST_STARTUP_TIMEOUT_MS);
        hostProcess.stdout.setEncoding("utf8");
        hostProcess.stdout.on("data", chunk => {
          stdout += String(chunk);
          if (
            stdout.includes("Pair this device:") &&
            stdout.includes("If HTTPS is not trusted")
          ) {
            clearTimeout(timeout);
            resolve();
          }
        });
        hostProcess.stderr.setEncoding("utf8");
        hostProcess.stderr.on("data", chunk => {
          stderr += String(chunk);
        });
        hostProcess.once("error", error => {
          clearTimeout(timeout);
          reject(error);
        });
        hostProcess.once("exit", code => {
          clearTimeout(timeout);
          reject(new Error(`Development Host exited with code ${code}`));
        });
      });

      const reportedOrigin = stdout.match(
        /Pidex ready at (https:\/\/[^ ]+)/,
      )?.[1];
      const pairingUrl = stdout.match(
        /Pair this device: (https:\/\/[^/]+\/\?pair=[A-Z0-9_-]{20})/,
      )?.[1];
      const certificatePath = join(
        profileRoot,
        "Pidex",
        "Development CA",
        "pidex-development-ca.pem",
      );

      assert.ok(reportedOrigin);
      assert.ok(pairingUrl);
      assert.match(reportedOrigin, /^https:\/\/192\.0\.2\.10:\d+$/);
      assert.equal(new URL(pairingUrl).origin, reportedOrigin);
      assert.match(stdout, /If HTTPS is not trusted/);
      assert.ok(stdout.includes(certificatePath));
    } finally {
      if (hostProcess.exitCode === null) {
        const hostExit = once(hostProcess, "exit");
        hostProcess.kill("SIGTERM");
        await hostExit;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
