import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { readStatus } from "../packages/cli/src/main.js";
import { startHost } from "../packages/host/src/host.js";
import {
  parseServerMessage,
  type HostStatus,
} from "../packages/protocol/src/status.js";

function readPwaStatus(origin: string, authorization: string): Promise<HostStatus> {
  return new Promise((resolve, reject) => {
    const controlOrigin = origin.replace("https:", "wss:");
    const controlSocket = new WebSocket(`${controlOrigin}/control`, {
      rejectUnauthorized: false,
      headers: { authorization: `Bearer ${authorization}` },
    });

    controlSocket.once("message", bytes => {
      try {
        const message = parseServerMessage(bytes.toString());
        controlSocket.close();
        resolve(message.status);
      } catch (error) {
        controlSocket.close();
        reject(error);
      }
    });
    controlSocket.once("error", reject);
  });
}

function readPwaShell(origin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = get(origin, { rejectUnauthorized: false }, response => {
      response.setEncoding("utf8");

      let body = "";
      response.on("data", chunk => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}

test("HTTPS PWA and CLI observe durable authoritative Host status across restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-product-"));

  try {
    const authorization = "product-test-device";
    const initialHost = await startHost({
      dataDir,
      port: 0,
      adapters: adaptersFor("deterministic"),
      authorization,
    });
    let initialStatus: HostStatus;

    try {
      const shell = await readPwaShell(initialHost.origin);
      assert.match(shell, /Pidex Host/);

      const [pwaStatus, cliStatus] = await Promise.all([
        readPwaStatus(initialHost.origin, authorization),
        readStatus(initialHost.origin, authorization),
      ]);
      assert.deepEqual(pwaStatus, cliStatus);
      assert.equal(cliStatus.readiness, "ready");
      assert.match(
        cliStatus.synchronization.cursor,
        new RegExp(`^${cliStatus.hostId}:`),
      );
      initialStatus = cliStatus;
    } finally {
      await initialHost.close();
    }

    const restartedHost = await startHost({
      dataDir,
      port: 0,
      adapters: adaptersFor("deterministic"),
      authorization,
    });

    try {
      assert.deepEqual(await readStatus(restartedHost.origin, authorization), initialStatus);
    } finally {
      await restartedHost.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
