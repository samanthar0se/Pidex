import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { readStatus } from "../packages/cli/src/main.js";
import {
  ensureCertificate,
  type HostCertificateProvisioningRequest,
} from "../packages/host/src/certificate.js";
import { startHost } from "../packages/host/src/host.js";
import { type HostStatus } from "../packages/protocol/src/status.js";
import { negotiateControl } from "./control-client.js";

async function readPwaStatus(
  origin: string,
  authorization: string,
): Promise<HostStatus> {
  const controlOrigin = origin.replace("https:", "wss:");
  const controlSocket = new WebSocket(`${controlOrigin}/control`, {
    rejectUnauthorized: false,
    headers: { authorization: `Bearer ${authorization}` },
  });
  const message = await negotiateControl(controlSocket);
  controlSocket.close();
  return message.status;
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
      assert.match(cliStatus.synchronization.cursor, /^sync_[A-Za-z0-9_-]+$/);
      assert.doesNotMatch(cliStatus.synchronization.cursor, new RegExp(cliStatus.hostId));
      initialStatus = cliStatus;
    } finally {
      await initialHost.close();
    }

    const generations = await readdir(join(dataDir, "authority", "generations"));
    assert.equal(generations.length, 0);
    await readFile(join(dataDir, "authority.sqlite"));

    const restartedHost = await startHost({
      dataDir,
      port: 0,
      adapters: adaptersFor("deterministic"),
      authorization,
    });

    try {
      assert.deepEqual(
        await readStatus(restartedHost.origin, authorization),
        initialStatus,
      );
    } finally {
      await restartedHost.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Host startup can use certificate material provisioned outside packaged TLS state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-certificate-seam-"));
  const certificateDataDir = join(root, "certificate");
  const hostDataDir = join(root, "host");
  const adapters = adaptersFor("deterministic");
  const provisioningRequests: HostCertificateProvisioningRequest[] = [];

  try {
    const certificate = ensureCertificate(
      certificateDataDir,
      "localhost",
      adapters.windows,
    );
    const host = await startHost({
      dataDir: hostDataDir,
      port: 0,
      adapters,
      certificateProvisioner: async request => {
        provisioningRequests.push(request);
        return certificate;
      },
    });

    try {
      assert.match(await readPwaShell(host.origin), /Pidex Host/);
      assert.deepEqual(provisioningRequests, [
        {
          dataDir: hostDataDir,
          hostname: "localhost",
          windows: adapters.windows,
        },
      ]);
      await assert.rejects(access(join(hostDataDir, "tls")));
    } finally {
      await host.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
