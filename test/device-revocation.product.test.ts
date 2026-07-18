import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { request } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost, type StartedHost } from "../packages/host/src/host.js";

async function post(origin: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const outgoing = request(new URL(path, origin), {
      method: "POST", rejectUnauthorized: false,
      headers: { "content-type": "application/json" },
    }, response => {
      let text = "";
      response.on("data", chunk => text += chunk);
      response.on("end", () => {
        const value = JSON.parse(text) as Record<string, unknown>;
        response.statusCode === 200 ? resolve(value) : reject(new Error(String(value.error)));
      });
    });
    outgoing.on("error", reject);
    outgoing.end(JSON.stringify(body));
  });
}

async function pair(host: StartedHost): Promise<{ deviceId: string; key: KeyObject }> {
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const instructions = host.createPairing();
  const challenge = await post(host.origin, "/pair/challenge", {
    secret: instructions.secret,
    publicKey: key.publicKey.export({ format: "jwk" }),
  });
  const completed = await post(host.origin, "/pair/complete", {
    pairingId: challenge.pairingId,
    signature: proof(key.privateKey, String(challenge.challenge)),
  });
  return { deviceId: String(completed.deviceId), key: key.privateKey };
}

async function authenticate(host: StartedHost, device: { deviceId: string; key: KeyObject }): Promise<string> {
  const challenge = await post(host.origin, "/pair/auth-challenge", { deviceId: device.deviceId });
  const authenticated = await post(host.origin, "/pair/authenticate", {
    authenticationId: challenge.authenticationId,
    signature: proof(device.key, String(challenge.challenge)),
  });
  return String(authenticated.session);
}

function proof(key: KeyObject, challenge: string): string {
  return sign("sha256", Buffer.from(challenge), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
}

function connect(origin: string, session: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace("https:", "wss:")}/control?session=${session}`, { rejectUnauthorized: false });
    socket.once("message", () => resolve(socket));
    socket.once("error", reject);
  });
}

test("a paired Device revokes one identity and its live and stale Client sessions only", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-revoke-"));
  const host = await startHost({ dataDir, port: 0, adapters: adaptersFor("deterministic") });
  try {
    const revoker = await pair(host);
    const target = await pair(host);
    const revokerSession = await authenticate(host, revoker);
    const staleTargetSession = await authenticate(host, target);
    const [revokerClient, targetClient] = await Promise.all([
      connect(host.origin, revokerSession), connect(host.origin, staleTargetSession),
    ]);
    const targetClosed = new Promise<number>(resolve => targetClient.once("close", resolve));
    revokerClient.send(JSON.stringify({ type: "device.revoke", deviceId: target.deviceId }));
    assert.equal(await targetClosed, 4003);

    await assert.rejects(authenticate(host, target), /unknown-device/);
    await assert.rejects(connect(host.origin, staleTargetSession));
    const sibling = await connect(host.origin, await authenticate(host, revoker));
    sibling.close();
    revokerClient.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
