const GIBIBYTE = 1024 ** 3;

export const capacityFixture = Object.freeze({
  retainedSessions: 10_000,
  timelineEntries: 100_000,
  clients: 6,
  devices: 3,
});

export interface CapacityUse {
  residentSessions: number;
  executingRuns: number;
  availableMemoryBytes: number;
}

/** Admission is pressure-based; tier floors are guarantees, not hard maxima. */
export class HostCapacityAdmission {
  readonly floor: { residentSessions: number; executingRuns: number };
  readonly retainedSessionLimit = undefined;
  readonly #osHeadroomBytes: number;

  constructor(options: { totalMemoryBytes: number; osHeadroomBytes?: number }) {
    if (options.totalMemoryBytes < 8 * GIBIBYTE) {
      throw new Error("unsupported-host-memory: 8 GiB required");
    }
    this.floor = options.totalMemoryBytes >= 16 * GIBIBYTE
      ? { residentSessions: 8, executingRuns: 4 }
      : { residentSessions: 4, executingRuns: 2 };
    this.#osHeadroomBytes = options.osHeadroomBytes ?? GIBIBYTE;
  }

  assess(use: CapacityUse): { admitted: boolean; reason?: string } {
    if (use.availableMemoryBytes < this.#osHeadroomBytes) {
      return {
        admitted: false,
        reason: `memory-pressure: ${use.availableMemoryBytes} bytes available; ${this.#osHeadroomBytes} OS headroom required`,
      };
    }
    return { admitted: true };
  }
}
