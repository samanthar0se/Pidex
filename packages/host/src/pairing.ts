import {
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";
import type { Clock } from "../../adapters/src/index.js";
import type { AuthorityStore } from "./store.js";

const PAIRING_LIFETIME_MS = 5 * 60_000;
const SESSION_LIFETIME_MS = 10 * 60_000;
const MAX_FAILURES = 5;

export interface PairingInstructions {
  secret: string;
  qrPayload: string;
  expiresAt: number;
  authorityNotice: string;
}

interface PendingProof { id: string; key: KeyObject; publicKey: JsonWebKey; challenge: string; }
interface ActivePairing { secret: string; expiresAt: number; failures: number; pending: Map<string, PendingProof>; }
interface AuthChallenge { deviceId: string; challenge: string; expiresAt: number; }

export class PairingAuthority {
  #pairing?: ActivePairing;
  readonly #authChallenges = new Map<string, AuthChallenge>();
  readonly #sessions = new Map<string, { deviceId: string; expiresAt: number }>();

  constructor(private readonly clock: Clock, private readonly store: AuthorityStore) {}

  create(canonicalOrigin: string): PairingInstructions {
    const secret = randomBytes(15).toString("base64url").toUpperCase();
    const expiresAt = this.clock.now() + PAIRING_LIFETIME_MS;
    this.#pairing = { secret, expiresAt, failures: 0, pending: new Map() };
    return {
      secret,
      qrPayload: `${canonicalOrigin}/?pair=${encodeURIComponent(secret)}`,
      expiresAt,
      authorityNotice: "This Device gains the complete Pidex surface and the signed-in Windows user's Pi machine authority.",
    };
  }

  begin(secret: unknown, publicKey: unknown): { pairingId: string; challenge: string } {
    const pairing = this.validPairing(secret);
    let key: KeyObject;
    try {
      if (!isP256PublicJwk(publicKey)) throw new Error();
      key = createPublicKey({ key: publicKey, format: "jwk" });
    } catch {
      this.fail(pairing);
      throw new PairingError(400, "malformed-public-key");
    }
    const proof: PendingProof = {
      id: randomUUID(), key, publicKey, challenge: randomBytes(32).toString("base64url"),
    };
    pairing.pending.set(proof.id, proof);
    return { pairingId: proof.id, challenge: proof.challenge };
  }

  complete(pairingId: unknown, signature: unknown): { deviceId: string } {
    const pairing = this.currentPairing();
    const proof = typeof pairingId === "string" ? pairing.pending.get(pairingId) : undefined;
    if (!proof || typeof signature !== "string") {
      this.fail(pairing);
      throw new PairingError(401, "invalid-pairing-proof");
    }
    let valid = false;
    try {
      valid = verify("sha256", Buffer.from(proof.challenge), { key: proof.key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    } catch { /* invalid signatures are ordinary bounded failures */ }
    if (!valid) {
      this.fail(pairing);
      throw new PairingError(401, "invalid-pairing-proof");
    }
    const deviceId = `device_${randomUUID()}`;
    this.store.addDevice(deviceId, JSON.stringify(proof.publicKey), this.clock.now());
    this.#pairing = undefined;
    return { deviceId };
  }

  beginAuthentication(deviceId: unknown): { authenticationId: string; challenge: string } {
    if (typeof deviceId !== "string" || !this.store.devicePublicKey(deviceId)) throw new PairingError(401, "unknown-device");
    const authenticationId = randomUUID();
    const value = { deviceId, challenge: randomBytes(32).toString("base64url"), expiresAt: this.clock.now() + 60_000 };
    this.#authChallenges.set(authenticationId, value);
    return { authenticationId, challenge: value.challenge };
  }

  authenticate(authenticationId: unknown, signature: unknown): { session: string; expiresAt: number } {
    const challenge = typeof authenticationId === "string" ? this.#authChallenges.get(authenticationId) : undefined;
    if (!challenge || challenge.expiresAt <= this.clock.now() || typeof signature !== "string") throw new PairingError(401, "invalid-authentication-proof");
    this.#authChallenges.delete(authenticationId as string);
    const jwk = this.store.devicePublicKey(challenge.deviceId);
    let valid = false;
    try {
      valid = !!jwk && verify("sha256", Buffer.from(challenge.challenge), { key: createPublicKey({ key: JSON.parse(jwk), format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    } catch { /* fail closed */ }
    if (!valid) throw new PairingError(401, "invalid-authentication-proof");
    const session = randomBytes(32).toString("base64url");
    const expiresAt = this.clock.now() + SESSION_LIFETIME_MS;
    this.#sessions.set(session, { deviceId: challenge.deviceId, expiresAt });
    return { session, expiresAt };
  }

  acceptsSession(token: string | undefined): boolean {
    if (!token) return false;
    const value = this.#sessions.get(token);
    if (!value || value.expiresAt <= this.clock.now()) { this.#sessions.delete(token); return false; }
    return true;
  }

  private validPairing(secret: unknown): ActivePairing {
    const pairing = this.currentPairing();
    const actual = Buffer.from(typeof secret === "string" ? secret : "");
    const wanted = Buffer.from(pairing.secret);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      this.fail(pairing);
      throw new PairingError(401, "invalid-pairing-secret");
    }
    return pairing;
  }
  private currentPairing(): ActivePairing {
    const value = this.#pairing;
    if (!value || value.expiresAt <= this.clock.now() || value.failures >= MAX_FAILURES) {
      this.#pairing = undefined;
      throw new PairingError(410, "pairing-unavailable");
    }
    return value;
  }
  private fail(pairing: ActivePairing): void { pairing.failures += 1; if (pairing.failures >= MAX_FAILURES) this.#pairing = undefined; }
}

export class PairingError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function isP256PublicJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== "object") return false;
  const key = value as Record<string, unknown>;
  return key.kty === "EC" && key.crv === "P-256" && typeof key.x === "string" && typeof key.y === "string" && key.d === undefined;
}
