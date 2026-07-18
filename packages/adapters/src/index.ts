export interface Clock {
  now(): number;
}

export interface PiAdapter {
  readonly kind: "real" | "deterministic";
}

export interface NetworkAdapter {
  beforeSend(): void;
}

export interface StorageFaultAdapter {
  beforeCommit(): void;
}

export interface WindowsPlatformAdapter {
  readonly kind: "windows" | "deterministic";
  protectForCurrentUser(cleartext: Buffer): Buffer;
  unprotectForCurrentUser(envelope: Buffer): Buffer;
  restrictToCurrentUser(path: string): void;
  trustCurrentUserCertificate(path: string): void;
  registerLogonTask(command: string, args: readonly string[]): void;
}

export interface HostAdapters {
  clock: Clock;
  pi: PiAdapter;
  network: NetworkAdapter;
  storage: StorageFaultAdapter;
  windows: WindowsPlatformAdapter;
}

export type AdapterMode = "product" | "deterministic";

export function adaptersFor(mode: AdapterMode = "product"): HostAdapters {
  const deterministic = mode === "deterministic";

  return {
    clock: {
      now: () => (deterministic ? 1_700_000_000_000 : Date.now()),
    },
    pi: { kind: deterministic ? "deterministic" : "real" },
    network: { beforeSend() {} },
    storage: { beforeCommit() {} },
    windows: deterministic
      ? {
          kind: "deterministic",
          protectForCurrentUser: cleartext =>
            Buffer.concat([Buffer.from("PIDEX-DPAPI-V1\0"), cleartext]),
          unprotectForCurrentUser: envelope => envelope.subarray(15),
          restrictToCurrentUser() {},
          trustCurrentUserCertificate() {},
          registerLogonTask() {},
        }
      : windowsAdapter(),
  };
}

function windowsAdapter(): WindowsPlatformAdapter {
  if (process.platform !== "win32") {
    throw new Error("The product Windows adapter requires Windows");
  }

  // Native operations are deliberately concentrated here. The packaged Windows
  // build supplies the signed native bridge; no privileged daemon is required.
  return {
    kind: "windows",
    protectForCurrentUser() {
      throw new Error("Pidex Windows native DPAPI bridge is not bundled");
    },
    unprotectForCurrentUser() {
      throw new Error("Pidex Windows native DPAPI bridge is not bundled");
    },
    restrictToCurrentUser() {
      throw new Error("Pidex Windows native ACL bridge is not bundled");
    },
    trustCurrentUserCertificate() {
      throw new Error("Pidex Windows certificate bridge is not bundled");
    },
    registerLogonTask() {
      throw new Error("Pidex Windows Task Scheduler bridge is not bundled");
    },
  };
}
