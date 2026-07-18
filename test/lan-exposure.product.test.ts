import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  adaptersFor,
  executePidexFirewallOperation,
  type HostAdapters,
  type PidexAdvertisement,
} from "../packages/adapters/src/index.js";
import {
  startHost,
  type StartedHost,
} from "../packages/host/src/host.js";
import {
  startOnboarding,
  type StartedOnboarding,
} from "../packages/host/src/onboarding.js";

function openControlWithoutAuthorization(host: StartedHost): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${host.origin.replace("https:", "wss:")}/control`,
      { rejectUnauthorized: false },
    );
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
}

function fetchOnboardingContent(
  onboarding: StartedOnboarding,
  path: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const call = get(`${onboarding.origin}${path}`, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
      });
      response.on("end", () => {
        resolve(body);
      });
    });
    call.on("error", reject);
  });
}

function postOnboardingCredential(origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const call = request(origin, { method: "POST" }, response => {
      if (response.statusCode === undefined) {
        reject(new Error("Onboarding response did not include a status code"));
        return;
      }
      resolve(response.statusCode);
    });
    call.on("error", reject);
    call.end("credential=x");
  });
}

test("LAN exposure stays canonical, private-discovered, warning-visible, and authenticated", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-lan-"));
  const base = adaptersFor("deterministic");
  let advertised: PidexAdvertisement | undefined;
  const events: string[] = [];
  const firewallOperations: string[] = [];
  const adapters: HostAdapters = {
    ...base,
    windows: {
      ...base.windows,
      privateInterfaces: () => [
        {
          name: "Wi-Fi",
          addresses: ["192.168.1.8"],
          profile: "private",
        },
      ],
      inspectPidexFirewall: () => ({
        state: "broadened",
        detail: "Pidex rule includes Public profile",
      }),
      advertisePidex: value => {
        advertised = value;
        return () => {
          advertised = undefined;
        };
      },
      applyPidexFirewall: operation => {
        firewallOperations.push(operation.operation);
      },
      writeCoarseEvent: event => {
        events.push(event.code);
      },
    },
  };

  try {
    const host = await startHost({
      dataDir,
      port: 0,
      hostname: "localhost",
      authorization: "paired",
      adapters,
    });
    try {
      assert.equal(advertised?.service, "_pidex._tcp.local");
      assert.deepEqual(
        advertised?.interfaces.map(value => value.name),
        ["Wi-Fi"],
      );
      assert.deepEqual(Object.keys(advertised?.txt ?? {}).sort(), [
        "fingerprint",
        "label",
        "location",
        "version",
      ]);
      assert.equal(host.status().warnings[0]?.severity, "high");
      assert.deepEqual(events, ["PIDEX_FIREWALL_DEGRADED"]);
      assert.deepEqual(firewallOperations, ["ensure-private-rule"]);
      await assert.rejects(
        () => openControlWithoutAuthorization(host),
        /401/,
      );
    } finally {
      await host.close();
    }
    assert.equal(advertised, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("temporary loopback onboarding serves only instructions and CA, then expires", async () => {
  const onboarding = await startOnboarding({
    caCertificate: Buffer.from("PUBLIC CA"),
    canonicalOrigin: "https://pidex-example.local:47831",
    expiresInMs: 30,
  });
  assert.match(
    await fetchOnboardingContent(onboarding, "/"),
    /pidex-example\.local:47831/,
  );
  assert.equal(
    await fetchOnboardingContent(onboarding, "/pidex-ca.pem"),
    "PUBLIC CA",
  );
  const postStatus = await postOnboardingCredential(onboarding.origin);
  assert.equal(postStatus, 405);
  await new Promise(resolve => setTimeout(resolve, 60));
  await assert.rejects(() => fetchOnboardingContent(onboarding, "/"));
  await onboarding.close();
});

test("privileged Firewall boundary rejects broadened and arbitrary operations", () => {
  const windows = adaptersFor("deterministic").windows;
  assert.throws(
    () =>
      executePidexFirewallOperation(windows, {
        operation: "ensure-private-rule",
        port: 47831,
        profiles: ["Public"],
      }),
    /Invalid/,
  );
  assert.throws(
    () =>
      executePidexFirewallOperation(windows, {
        operation: "run",
        command: "netsh",
      }),
    /Invalid/,
  );
});
