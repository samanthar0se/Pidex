import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type PushCategory = "interaction" | "run" | "held" | "piProblem";
export type PushHintCategory = PushCategory | "revocation";
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
  category: PushHintCategory;
  path: string;
  title: string;
  body: string;
}

type RevocationFact = Pick<
  PushHint,
  "eventId" | "hostId" | "occurredAt"
>;

type PushTransport = (
  subscription: string,
  encrypted: Uint8Array,
) => Promise<void>;
const MAX_PAYLOAD_BYTES = 4096;
const MAX_PREVIEW_LENGTH = 512;
const GENERIC_TITLE = "Pidex needs attention";
const GENERIC_BODY = "Open Pidex to reconcile current state.";
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
      preferences: {
        privacy: "rich",
        categories: DEFAULT_CATEGORIES,
        ...preferences,
      },
      delivered: previous?.delivered ?? new Set(),
      failures: previous?.failures ?? 0,
    });
  }

  async publish(fact: PushFact): Promise<number> {
    if (fact.category === "routine") {
      return 0;
    }

    const category = fact.category;
    const deliveryResults = await Promise.all(
      [...this.#devices.values()].map(device =>
        this.deliverToDevice(device, fact, category),
      ),
    );
    return deliveryResults.filter(delivered => delivered).length;
  }

  deliveryFailures(deviceId: string): number {
    return this.#devices.get(deviceId)?.failures ?? 0;
  }

  /** Remove delivery authority before attempting one non-authoritative final hint. */
  async revoke(
    deviceId: string,
    revocation?: RevocationFact,
  ): Promise<boolean> {
    const device = this.#devices.get(deviceId);
    this.#devices.delete(deviceId);
    if (!device || !revocation) {
      return false;
    }

    const { preferences } = device;
    if (!preferences.subscription || !preferences.encryptionKey) {
      return false;
    }

    const hint: PushHint = {
      version: 1,
      ...revocation,
      category: "revocation",
      path: "/",
      title: "Device revoked",
      body: "Open Pidex to remove local Device data.",
    };
    try {
      await this.send(
        preferences.subscription,
        encryptPushHint(hint, preferences.encryptionKey),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async deliverToDevice(
    device: DeviceDelivery,
    fact: PushFact,
    category: PushCategory,
  ): Promise<boolean> {
    const preferences = device.preferences;
    if (
      !preferences.enabled ||
      preferences.permission === "denied" ||
      !preferences.subscription ||
      !preferences.encryptionKey ||
      preferences.categories?.[category] === false ||
      device.delivered.has(fact.eventId)
    ) {
      return false;
    }

    const useGenericText = preferences.privacy === "generic";
    const hint: PushHint = {
      version: 1,
      eventId: fact.eventId,
      hostId: fact.hostId,
      occurredAt: fact.occurredAt,
      category,
      path: canonicalPath(fact.path),
      title: useGenericText ? GENERIC_TITLE : titleFor(category),
      body: useGenericText
        ? GENERIC_BODY
        : truncateWithEllipsis(fact.preview, MAX_PREVIEW_LENGTH),
    };
    const encrypted = encryptPushHint(hint, preferences.encryptionKey);
    if (encrypted.byteLength > MAX_PAYLOAD_BYTES) {
      return false;
    }

    try {
      await this.send(preferences.subscription, encrypted);
      device.delivered.add(fact.eventId);
      return true;
    } catch {
      // Push outage is advisory: do not retry, alter, or delay the Host fact.
      device.failures++;
      return false;
    }
  }
}

export function encryptPushHint(hint: PushHint, key: Uint8Array): Uint8Array {
  if (key.byteLength !== 32) {
    throw Error("push encryption key must be 256 bits");
  }

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(hint)),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([1]),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptPushHint(payload: Uint8Array, key: Uint8Array): PushHint {
  const data = Buffer.from(payload);
  if (data[0] !== 1) {
    throw Error("unsupported push envelope");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(1, 13));
  decipher.setAuthTag(data.subarray(13, 29));
  const plaintext = Buffer.concat([
    decipher.update(data.subarray(29)),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString()) as PushHint;
}

function truncateWithEllipsis(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

function canonicalPath(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function titleFor(category: PushCategory): string {
  switch (category) {
    case "interaction":
      return "Interaction opened";
    case "run":
      return "Run finished";
    case "held":
      return "Work held for review";
    case "piProblem":
      return "Pi reported a problem";
  }
}
