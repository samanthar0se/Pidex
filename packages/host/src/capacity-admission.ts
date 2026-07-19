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

export interface CapacityFloor {
  residentSessions: number;
  executingRuns: number;
}

export type CapacityAssessment =
  | { admitted: true }
  | { admitted: false; reason: string };

export interface HostCapacityOptions {
  totalMemoryBytes: number;
  osHeadroomBytes?: number;
}

/** Admission is pressure-based; tier floors are guarantees, not hard maxima. */
export class HostCapacityAdmission {
  readonly floor: CapacityFloor;
  readonly retainedSessionLimit: undefined = undefined;
  readonly #osHeadroomBytes: number;

  constructor(options: HostCapacityOptions) {
    if (options.totalMemoryBytes < 8 * GIBIBYTE) {
      throw new Error("unsupported-host-memory: 8 GiB required");
    }

    if (options.totalMemoryBytes >= 16 * GIBIBYTE) {
      this.floor = { residentSessions: 8, executingRuns: 4 };
    } else {
      this.floor = { residentSessions: 4, executingRuns: 2 };
    }
    this.#osHeadroomBytes = options.osHeadroomBytes ?? GIBIBYTE;
  }

  assess(use: CapacityUse): CapacityAssessment {
    if (use.availableMemoryBytes < this.#osHeadroomBytes) {
      return {
        admitted: false,
        reason: `memory-pressure: ${use.availableMemoryBytes} bytes available; ${this.#osHeadroomBytes} OS headroom required`,
      };
    }
    return { admitted: true };
  }
}
