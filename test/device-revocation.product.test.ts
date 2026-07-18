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
import { negotiateControl } from "./control-client.js";

interface PairedDevice {
  deviceId: string;
  privateKey: KeyObject;
}

function post(
  origin: string,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      new URL(path, origin),
      {
        method: "POST",
        rejectUnauthorized: false,
        headers: { "content-type": "application/json" },
      },
      response => {
        let responseText = "";
        response.on("data", chunk => {
          responseText += chunk;
        });
        response.on("end", () => {
          const responseBody = parseJsonObject(responseText);
          if (response.statusCode === 200) {
            resolve(responseBody);
            return;
          }
          reject(new Error(String(responseBody.error)));
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(JSON.stringify(body));
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isJsonObject(value)) {
    throw new TypeError("Expected an object in the JSON response");
  }
  return value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    throw new TypeError(`Expected response field ${field} to be a string`);
  }
  return fieldValue;
}

async function pairDevice(host: StartedHost): Promise<PairedDevice> {
  const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const instructions = host.createPairing();
  const challenge = await post(host.origin, "/pair/challenge", {
    secret: instructions.secret,
    publicKey: keyPair.publicKey.export({ format: "jwk" }),
  });
  const completed = await post(host.origin, "/pair/complete", {
    pairingId: stringField(challenge, "pairingId"),
    signature: signChallenge(
      keyPair.privateKey,
      stringField(challenge, "challenge"),
    ),
  });
  return {
    deviceId: stringField(completed, "deviceId"),
    privateKey: keyPair.privateKey,
  };
}

async function authenticateDevice(
  host: StartedHost,
  device: PairedDevice,
): Promise<string> {
  const challenge = await post(host.origin, "/pair/auth-challenge", {
    deviceId: device.deviceId,
  });
  const authenticated = await post(host.origin, "/pair/authenticate", {
    authenticationId: stringField(challenge, "authenticationId"),
    signature: signChallenge(
      device.privateKey,
      stringField(challenge, "challenge"),
    ),
  });
  return stringField(authenticated, "session");
}

function signChallenge(key: KeyObject, challenge: string): string {
  return sign("sha256", Buffer.from(challenge), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
}

async function connectClient(
  origin: string,
  session: string,
): Promise<WebSocket> {
  const controlUrl =
    `${origin.replace("https:", "wss:")}/control?session=${session}`;
  const socket = new WebSocket(controlUrl, { rejectUnauthorized: false });
  await negotiateControl(socket);
  return socket;
}

test("a paired Device revokes one identity and its live and stale Client sessions only", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-revoke-"));
  const host = await startHost({
    dataDir,
    port: 0,
    adapters: adaptersFor("deterministic"),
  });
  try {
    const revoker = await pairDevice(host);
    const target = await pairDevice(host);
    const revokerSession = await authenticateDevice(host, revoker);
    const staleTargetSession = await authenticateDevice(host, target);
    const [revokerClient, targetClient] = await Promise.all([
      connectClient(host.origin, revokerSession),
      connectClient(host.origin, staleTargetSession),
    ]);
    const targetClosed = new Promise<number>(resolve => {
      targetClient.once("close", code => resolve(code));
    });
    revokerClient.send(
      JSON.stringify({ type: "device.revoke", deviceId: target.deviceId }),
    );
    assert.equal(await targetClosed, 4003);

    await assert.rejects(authenticateDevice(host, target), /unknown-device/);
    await assert.rejects(connectClient(host.origin, staleTargetSession));
    const sibling = await connectClient(
      host.origin,
      await authenticateDevice(host, revoker),
    );
    sibling.close();
    revokerClient.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
