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
    windows: { kind: deterministic ? "deterministic" : "windows" },
  };
}
