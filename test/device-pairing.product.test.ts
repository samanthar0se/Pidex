import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { request } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptersFor, type HostAdapters } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";

function post(origin: string, path: string, body: unknown, host?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, origin);
    const call = request(url, {
      method: "POST", rejectUnauthorized: false,
      headers: { "content-type": "application/json", ...(host ? { host } : {}) },
    }, response => {
      let text = "";
      response.on("data", chunk => text += chunk);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: text ? JSON.parse(text) : undefined }));
    });
    call.on("error", reject);
    call.end(JSON.stringify(body));
  });
}

function key() {
  return generateKeyPairSync("ec", { namedCurve: "P-256" });
}

test("one-time pairing registers a public Device key and authenticates only signed challenges", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-pair-"));
  let now = 1_700_000_000_000;
  const base = adaptersFor("deterministic");
  const adapters: HostAdapters = { ...base, clock: { now: () => now } };
  const host = await startHost({ dataDir, port: 0, adapters });
  try {
    const instructions = host.createPairing();
    assert.match(instructions.authorityNotice, /complete Pidex surface.*Windows user's Pi machine authority/);
    assert.equal(JSON.stringify(host.status()).includes(instructions.secret), false);

    const deviceKey = key();
    const publicKey = deviceKey.publicKey.export({ format: "jwk" });
    const challenge = await post(host.origin, "/pair/challenge", { secret: instructions.secret, publicKey });
    assert.equal(challenge.status, 200);
    const proof = sign("sha256", Buffer.from(challenge.body.challenge), { key: deviceKey.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    const [paired, replay] = await Promise.all([
      post(host.origin, "/pair/complete", { pairingId: challenge.body.pairingId, signature: proof }),
      post(host.origin, "/pair/complete", { pairingId: challenge.body.pairingId, signature: proof }),
    ]);
    assert.deepEqual([paired.status, replay.status].sort(), [200, 410]);
    const deviceId = (paired.status === 200 ? paired : replay).body.deviceId;

    const auth = await post(host.origin, "/pair/auth-challenge", { deviceId });
    const authProof = sign("sha256", Buffer.from(auth.body.challenge), { key: deviceKey.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    const session = await post(host.origin, "/pair/authenticate", { authenticationId: auth.body.authenticationId, signature: authProof });
    assert.equal(session.status, 200);
    assert.ok(session.body.expiresAt <= now + 10 * 60_000);

    const expired = host.createPairing();
    now = expired.expiresAt;
    assert.equal((await post(host.origin, "/pair/challenge", { secret: expired.secret, publicKey })).status, 410);

    now += 1;
    const bounded = host.createPairing();
    for (let attempt = 0; attempt < 4; attempt++) {
      assert.equal((await post(host.origin, "/pair/challenge", { secret: "wrong", publicKey })).status, 401);
    }
    assert.equal((await post(host.origin, "/pair/challenge", { secret: "wrong", publicKey })).status, 401);
    assert.equal((await post(host.origin, "/pair/challenge", { secret: bounded.secret, publicKey })).status, 410);

    const malformed = host.createPairing();
    assert.equal((await post(host.origin, "/pair/challenge", { secret: malformed.secret, publicKey: { kty: "oct", k: "secret" } })).status, 400);
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("pairing exchange rejects a non-canonical Host header", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-pair-origin-"));
  const host = await startHost({ dataDir, port: 0, hostname: "pidex-fixed.local", adapters: adaptersFor("deterministic") });
  try {
    const response = await post(host.origin.replace("pidex-fixed.local", "localhost"), "/pair/challenge", {}, "other.local");
    assert.equal(response.status, 421);
  } finally { await host.close(); await rm(dataDir, { recursive: true, force: true }); }
});
