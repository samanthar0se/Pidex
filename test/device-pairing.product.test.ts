import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { request } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptersFor, type HostAdapters } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";

interface JsonResponse {
  status: number;
  body: Record<string, unknown> | undefined;
}

function post(
  origin: string,
  path: string,
  body: unknown,
  host?: string,
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, origin);
    const requestOptions = {
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        "content-type": "application/json",
        ...(host ? { host } : {}),
      },
    };
    const outgoingRequest = request(url, requestOptions, response => {
      let responseText = "";
      response.on("data", chunk => {
        responseText += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: responseText ? parseJsonObject(responseText) : undefined,
        });
      });
    });
    outgoingRequest.on("error", reject);
    outgoingRequest.end(JSON.stringify(body));
  });
}

function generateDeviceKey() {
  return generateKeyPairSync("ec", { namedCurve: "P-256" });
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

function stringResponseField(response: JsonResponse, field: string): string {
  const value = response.body?.[field];
  if (typeof value !== "string") {
    throw new TypeError(`Expected response field ${field} to be a string`);
  }
  return value;
}

function numberResponseField(response: JsonResponse, field: string): number {
  const value = response.body?.[field];
  if (typeof value !== "number") {
    throw new TypeError(`Expected response field ${field} to be a number`);
  }
  return value;
}

async function assertPostStatus(
  origin: string,
  path: string,
  body: unknown,
  expectedStatus: number,
): Promise<void> {
  const response = await post(origin, path, body);
  assert.equal(response.status, expectedStatus);
}

test("one-time pairing registers a public Device key and authenticates only signed challenges", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-pair-"));
  let now = 1_700_000_000_000;
  const base = adaptersFor("deterministic");
  const adapters: HostAdapters = { ...base, clock: { now: () => now } };
  const host = await startHost({ dataDir, port: 0, adapters });
  try {
    const instructions = host.createPairing();
    assert.match(
      instructions.authorityNotice,
      /complete Pidex surface.*Windows user's Pi machine authority/,
    );
    assert.equal(JSON.stringify(host.status()).includes(instructions.secret), false);

    const deviceKey = generateDeviceKey();
    const publicKey = deviceKey.publicKey.export({ format: "jwk" });
    const challenge = await post(host.origin, "/pair/challenge", {
      secret: instructions.secret,
      publicKey,
    });
    assert.equal(challenge.status, 200);
    const proof = sign(
      "sha256",
      Buffer.from(stringResponseField(challenge, "challenge")),
      { key: deviceKey.privateKey, dsaEncoding: "ieee-p1363" },
    ).toString("base64url");
    const pairingId = stringResponseField(challenge, "pairingId");
    const [paired, replay] = await Promise.all([
      post(host.origin, "/pair/complete", { pairingId, signature: proof }),
      post(host.origin, "/pair/complete", { pairingId, signature: proof }),
    ]);
    assert.deepEqual([paired.status, replay.status].sort(), [200, 410]);
    const successfulPairing = paired.status === 200 ? paired : replay;
    const deviceId = stringResponseField(successfulPairing, "deviceId");

    const auth = await post(host.origin, "/pair/auth-challenge", { deviceId });
    const authProof = sign(
      "sha256",
      Buffer.from(stringResponseField(auth, "challenge")),
      { key: deviceKey.privateKey, dsaEncoding: "ieee-p1363" },
    ).toString("base64url");
    const session = await post(host.origin, "/pair/authenticate", {
      authenticationId: stringResponseField(auth, "authenticationId"),
      signature: authProof,
    });
    assert.equal(session.status, 200);
    assert.ok(
      numberResponseField(session, "expiresAt") <= now + 10 * 60_000,
    );

    const expired = host.createPairing();
    now = expired.expiresAt;
    await assertPostStatus(
      host.origin,
      "/pair/challenge",
      { secret: expired.secret, publicKey },
      410,
    );

    now += 1;
    const bounded = host.createPairing();
    for (let attempt = 0; attempt < 4; attempt++) {
      await assertPostStatus(
        host.origin,
        "/pair/challenge",
        { secret: "wrong", publicKey },
        401,
      );
    }
    await assertPostStatus(
      host.origin,
      "/pair/challenge",
      { secret: "wrong", publicKey },
      401,
    );
    await assertPostStatus(
      host.origin,
      "/pair/challenge",
      { secret: bounded.secret, publicKey },
      410,
    );

    const malformed = host.createPairing();
    await assertPostStatus(
      host.origin,
      "/pair/challenge",
      {
        secret: malformed.secret,
        publicKey: { kty: "oct", k: "secret" },
      },
      400,
    );
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("pairing exchange rejects a non-canonical Host header", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-pair-origin-"));
  const host = await startHost({
    dataDir,
    port: 0,
    hostname: "pidex-fixed.local",
    adapters: adaptersFor("deterministic"),
  });
  try {
    const response = await post(
      host.origin.replace("pidex-fixed.local", "localhost"),
      "/pair/challenge",
      {},
      "other.local",
    );
    assert.equal(response.status, 421);
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
