export const MINIMUM_SUPPORTED_CAPACITY_BYTES = 8 * 1024 ** 3;
export const DEFAULT_EMERGENCY_RESERVE_BYTES = 512 * 1024 ** 2;
export const DEFAULT_ADMISSION_HEADROOM_BYTES = 1024 * 1024 ** 2;

export interface StorageProtectionOptions {
  capacityBytes?: number;
  emergencyReserveBytes?: number;
  admissionHeadroomBytes?: number;
  availableBytes: () => number;
}

export interface StorageProtectionStatus {
  mode: "normal" | "protected" | "reserve";
  availableBytes: number;
  capacityBytes: number;
  emergencyReserveBytes: number;
  admissionHeadroomBytes: number;
}

/** Keeps discretionary commands out of capacity reserved for accepted work. */
export class StorageProtection {
  readonly #options: Required<StorageProtectionOptions>;

  constructor(options: StorageProtectionOptions) {
    const capacityBytes = options.capacityBytes ?? MINIMUM_SUPPORTED_CAPACITY_BYTES;
    const emergencyReserveBytes =
      options.emergencyReserveBytes ?? DEFAULT_EMERGENCY_RESERVE_BYTES;
    const admissionHeadroomBytes =
      options.admissionHeadroomBytes ?? DEFAULT_ADMISSION_HEADROOM_BYTES;
    if (
      capacityBytes < MINIMUM_SUPPORTED_CAPACITY_BYTES ||
      emergencyReserveBytes <= 0 ||
      admissionHeadroomBytes <= emergencyReserveBytes ||
      admissionHeadroomBytes > capacityBytes / 4
    ) {
      throw new Error("invalid-storage-protection-thresholds");
    }
    this.#options = {
      ...options,
      capacityBytes,
      emergencyReserveBytes,
      admissionHeadroomBytes,
    };
  }

  status(): StorageProtectionStatus {
    const measuredBytes = this.#options.availableBytes();
    const availableBytes = Number.isFinite(measuredBytes)
      ? Math.max(0, measuredBytes)
      : 0;
    let mode: StorageProtectionStatus["mode"] = "normal";
    if (availableBytes <= this.#options.emergencyReserveBytes) {
      mode = "reserve";
    } else if (availableBytes <= this.#options.admissionHeadroomBytes) {
      mode = "protected";
    }

    return {
      mode,
      availableBytes,
      capacityBytes: this.#options.capacityBytes,
      emergencyReserveBytes: this.#options.emergencyReserveBytes,
      admissionHeadroomBytes: this.#options.admissionHeadroomBytes,
    };
  }

  admitDiscretionary(cleanSafeData: () => void): void {
    if (this.status().mode === "normal") return;
    cleanSafeData();
    const status = this.status();
    if (status.mode !== "normal") {
      throw new Error(
        `storage-pressure: ${status.availableBytes} bytes available; ` +
          `${status.admissionHeadroomBytes} required. Reads and accepted-work controls remain available; run storage maintenance or free Host disk space.`,
      );
    }
  }
}
