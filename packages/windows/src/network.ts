import { z } from "zod";
import { mapWindowsNativeError, type WindowsPlatformError } from "./errors.js";
import type {
  ManagedWindowsResource,
  NetworkPort,
  PidexDnsSdAdvertisement,
  PrivateNetworkInterface,
} from "./ports.js";

const interfaceSchema = z.strictObject({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  addresses: z.array(z.union([z.ipv4(), z.ipv6()])).max(64),
  profile: z.enum(["private", "public", "domain-authenticated"]),
});
const interfacesSchema = z.array(interfaceSchema).max(256);
const advertisementSchema = z.strictObject({
  service: z.literal("_pidex._tcp.local"),
  hostname: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  interfaces: z.array(interfaceSchema.extend({ profile: z.literal("private") })).min(1).max(256),
  txt: z.strictObject({
    location: z.string().url().max(512),
    label: z.string().min(1).max(128),
    version: z.string().min(1).max(16),
    fingerprint: z.string().regex(/^[a-f0-9]{16,64}$/),
  }),
});

export interface NativeNetworkResource {
  close(): Promise<void>;
}

export interface NativeNetworkBinding {
  snapshotInterfaces(): Promise<unknown>;
  observeInterfaces(
    onChange: (snapshot: unknown) => void,
    onFault: (fault: unknown) => void,
  ): Promise<NativeNetworkResource>;
  openAdvertisement(
    input: PidexDnsSdAdvertisement,
    onFault?: (fault: unknown) => void,
  ): Promise<NativeNetworkResource>;
}

export function createNetworkPort(native: NativeNetworkBinding): NetworkPort {
  let advertisementOpen = false;
  return {
    async snapshotPrivateInterfaces() {
      return privateOnly(await native.snapshotInterfaces());
    },
    async observePrivateInterfaces(listener) {
      let managed!: ManagedResource;
      const resource = await native.observeInterfaces(
        snapshot => managed?.dispatch(() => listener(privateOnly(snapshot))),
        fault => managed?.fault(fault, "observePrivateInterfaces"),
      );
      managed = new ManagedResource(resource);
      return managed;
    },
    async openAdvertisement(input) {
      const parsed = advertisementSchema.parse(input) as PidexDnsSdAdvertisement;
      if (advertisementOpen) throw new Error("Pidex DNS-SD advertisement is already open");
      advertisementOpen = true;
      try {
        let managed!: ManagedResource;
        const resource = await native.openAdvertisement(
          parsed,
          fault => managed?.fault(fault, "openAdvertisement"),
        );
        managed = new ManagedResource(resource, () => { advertisementOpen = false; });
        return managed;
      } catch (error) {
        advertisementOpen = false;
        throw error;
      }
    },
  };
}

function privateOnly(input: unknown): readonly PrivateNetworkInterface[] {
  return interfacesSchema.parse(input)
    .filter(candidate => candidate.profile === "private")
    .map(candidate => ({ ...candidate, profile: "private" as const }));
}

class ManagedResource implements ManagedWindowsResource {
  readonly lateFault: Promise<WindowsPlatformError>;
  private resolveFault!: (fault: WindowsPlatformError) => void;
  private closing?: Promise<void>;
  private active = true;
  private callbacks = Promise.resolve();

  constructor(
    private readonly native: NativeNetworkResource,
    private readonly didClose: () => void = () => undefined,
  ) {
    this.lateFault = new Promise(resolve => { this.resolveFault = resolve; });
  }

  dispatch(callback: () => void | Promise<void>): void {
    if (!this.active) return;
    this.callbacks = this.callbacks.then(async () => {
      if (this.active) await callback();
    });
  }

  fault(error: unknown, operation: string): void {
    if (this.active) this.resolveFault(mapWindowsNativeError(error, operation));
  }

  close(): Promise<void> {
    return this.closing ??= this.closeOnce();
  }

  private async closeOnce(): Promise<void> {
    this.active = false;
    try {
      await this.native.close();
      await this.callbacks;
    } finally {
      this.didClose();
    }
  }
}
