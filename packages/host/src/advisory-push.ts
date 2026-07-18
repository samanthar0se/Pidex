import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type PushCategory = "interaction" | "run" | "held" | "piProblem";
export type PushFactCategory = PushCategory | "routine";

export interface PushFact {
  category: PushFactCategory;
  /** Stable identity assigned by Host authority, not by the delivery channel. */
  eventId: string;
  hostId: string;
  occurredAt: string;
  path: string;
  preview: string;
}

export interface PushPreferences {
  enabled: boolean;
  permission?: "default" | "granted" | "denied";
  privacy?: "rich" | "generic";
  categories?: Partial<Record<PushCategory, boolean>>;
  subscription?: string;
  /** Device-specific Web Push content-encryption key. Never enters a hint. */
  encryptionKey?: Uint8Array;
}

export interface PushHint {
  version: 1;
  eventId: string;
  hostId: string;
  occurredAt: string;
  category: PushCategory;
  path: string;
  title: string;
  body: string;
}

type PushTransport = (subscription: string, encrypted: Uint8Array) => Promise<void>;
const MAX_PAYLOAD_BYTES = 4096;
const DEFAULT_CATEGORIES: Record<PushCategory, boolean> = {
  interaction: true,
  run: true,
  held: true,
  piProblem: true,
};

interface DeviceDelivery {
  preferences: PushPreferences;
  delivered: Set<string>;
  failures: number;
}

/** Best-effort projection of Host facts. It has no command or state mutation API. */
export class AdvisoryPush {
  readonly #devices = new Map<string, DeviceDelivery>();

  constructor(private readonly send: PushTransport) {}

  configure(deviceId: string, preferences: PushPreferences): void {
    const previous = this.#devices.get(deviceId);
    this.#devices.set(deviceId, {
      preferences: { privacy: "rich", categories: DEFAULT_CATEGORIES, ...preferences },
      delivered: previous?.delivered ?? new Set(),
      failures: previous?.failures ?? 0,
    });
  }

  async publish(fact: PushFact): Promise<number> {
    if (fact.category === "routine") return 0;
    const category = fact.category as PushCategory;
    let deliveries = 0;
    await Promise.all([...this.#devices.values()].map(async device => {
      const p = device.preferences;
      if (!p.enabled || p.permission === "denied" || !p.subscription ||
          !p.encryptionKey || p.categories?.[category] === false ||
          device.delivered.has(fact.eventId)) return;

      const generic = p.privacy === "generic";
      const hint: PushHint = {
        version: 1,
        eventId: fact.eventId,
        hostId: fact.hostId,
        occurredAt: fact.occurredAt,
        category,
        path: canonicalPath(fact.path),
        title: generic ? "Pidex needs attention" : titleFor(category),
        body: generic ? "Open Pidex to reconcile current state." : bounded(fact.preview, 512),
      };
      const encrypted = encryptPushHint(hint, p.encryptionKey);
      if (encrypted.byteLength > MAX_PAYLOAD_BYTES) return;
      try {
        await this.send(p.subscription, encrypted);
        device.delivered.add(fact.eventId);
        deliveries++;
      } catch {
        // Push outage is advisory: do not retry, alter, or delay the Host fact.
        device.failures++;
      }
    }));
    return deliveries;
  }

  deliveryFailures(deviceId: string): number {
    return this.#devices.get(deviceId)?.failures ?? 0;
  }
}

export function encryptPushHint(hint: PushHint, key: Uint8Array): Uint8Array {
  if (key.byteLength !== 32) throw Error("push encryption key must be 256 bits");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(hint)), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptPushHint(payload: Uint8Array, key: Uint8Array): PushHint {
  const data = Buffer.from(payload);
  if (data[0] !== 1) throw Error("unsupported push envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(1, 13));
  decipher.setAuthTag(data.subarray(13, 29));
  return JSON.parse(Buffer.concat([
    decipher.update(data.subarray(29)), decipher.final(),
  ]).toString()) as PushHint;
}

function bounded(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function canonicalPath(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function titleFor(category: PushCategory): string {
  return ({ interaction: "Interaction opened", run: "Run finished",
    held: "Work held for review", piProblem: "Pi reported a problem" })[category];
}
