export const LATENCY_BUDGETS_MS = Object.freeze({
  coldUsableShell: 3_000,
  warmUsableShell: 1_000,
  cachedRecentSessionOpen: 300,
  uncachedRecentSessionOpen: 2_000,
  hostCommandOutcome: 250,
  authoritativeReconciliation: 500,
  liveOutputAfterHostReceipt: 250,
  resumableReconnectCurrent: 3_000,
  sleepingWorkerReady: 5_000,
  daemonReady: 15_000,
});

export type LatencyMetric = keyof typeof LATENCY_BUDGETS_MS;
export type ExternalWait =
  | "providerMs"
  | "toolMs"
  | "userMediaMs"
  | "pushMs"
  | "backupDestinationMs";

type ExternalWaitTotals = Partial<Record<ExternalWait, number>>;

export const RESOURCE_BUDGETS = Object.freeze({
  launcherDaemonRssBytes: 300 * 1024 ** 2,
  launcherDaemonCpuPercent: 1,
  residentWorkerRssBytes: 300 * 1024 ** 2,
  clientHeapBytes: 300 * 1024 ** 2,
  timelineEntries: 100_000,
  responsiveTaskMs: 50,
  diagnosticBytes: 1024 ** 3,
  soakMemoryGrowthRatio: 0.1,
});

export interface PerformanceGateMetadata {
  build: string;
  environment: { os: string; browser: string; memoryBytes: number };
  network: { rttMs: number; lossPercent: number };
}

export interface LatencySample {
  localMs: number;
  external?: ExternalWaitTotals;
}

export interface QuiescentSample {
  launcherDaemonRssBytes: number;
  launcherDaemonCpuPercent: number;
  workerRssBytes: number[];
}

export interface ClientSample {
  timelineEntries: number;
  heapBytes: number;
  longestNavigationTaskMs: number;
}

export interface SoakSample {
  beforeRssBytes: number;
  afterRssBytes: number;
  handleSamples: number[];
  diagnosticBytes: number;
}

interface LatencyEvidence {
  samples: number;
  p95LocalMs: number;
  budgetMs: number;
  external: ExternalWaitTotals;
}

export interface PerformanceEvidence {
  schema: "pidex-performance-v1";
  metadata: PerformanceGateMetadata;
  latency: Partial<Record<LatencyMetric, LatencyEvidence>>;
  authorityAssertions: Record<string, boolean>;
  failures: string[];
  passed: boolean;
}

/** Produces artifact-ready evidence while keeping uncontrollable waits separate. */
export class PerformanceGate {
  readonly #latencies = new Map<LatencyMetric, LatencySample[]>();
  readonly #authority = new Map<string, boolean>();
  readonly #quiescent: QuiescentSample[] = [];
  readonly #clients: ClientSample[] = [];
  readonly #soaks: SoakSample[] = [];

  constructor(readonly metadata: PerformanceGateMetadata) {
    if (
      !metadata.build ||
      !metadata.environment.os ||
      !metadata.environment.browser
    ) {
      throw new Error("benchmark-metadata-incomplete");
    }
  }

  recordLatency(metric: LatencyMetric, sample: LatencySample): void {
    assertFiniteNonnegative(sample.localMs, "local latency");
    for (const value of Object.values(sample.external ?? {})) {
      assertFiniteNonnegative(value, "external latency");
    }
    const samples = this.#latencies.get(metric) ?? [];
    samples.push(sample);
    this.#latencies.set(metric, samples);
  }

  recordQuiescent(sample: QuiescentSample): void {
    this.#quiescent.push(sample);
  }

  recordClient(sample: ClientSample): void {
    this.#clients.push(sample);
  }

  recordSoak(sample: SoakSample): void {
    this.#soaks.push(sample);
  }

  assertAuthority(name: string, preserved: boolean): void {
    if (!name) {
      throw new Error("authority-assertion-name-required");
    }
    this.#authority.set(name, preserved);
  }

  evaluate(): PerformanceEvidence {
    const failures: string[] = [];

    if (
      this.metadata.network.rttMs > 50 ||
      this.metadata.network.lossPercent > 1
    ) {
      failures.push("unsupported-network-condition");
    }

    const latency = this.evaluateLatencies(failures);
    this.evaluateQuiescentSamples(failures);
    this.evaluateClientSamples(failures);
    this.evaluateSoakSamples(failures);

    const authorityAssertions = Object.fromEntries(this.#authority);
    const authorityWasNotPreserved = [...this.#authority.values()].some(
      preserved => !preserved,
    );
    if (this.#authority.size === 0 || authorityWasNotPreserved) {
      failures.push("authority-assertions-not-preserved");
    }

    const uniqueFailures = [...new Set(failures)];
    return {
      schema: "pidex-performance-v1",
      metadata: this.metadata,
      latency,
      authorityAssertions,
      failures: uniqueFailures,
      passed: uniqueFailures.length === 0,
    };
  }

  private evaluateLatencies(
    failures: string[],
  ): PerformanceEvidence["latency"] {
    const latency: PerformanceEvidence["latency"] = {};

    for (const [metric, samples] of this.#latencies) {
      const p95LocalMs = percentile95(samples.map(sample => sample.localMs));
      const budgetMs = LATENCY_BUDGETS_MS[metric];

      latency[metric] = {
        samples: samples.length,
        p95LocalMs,
        budgetMs,
        external: sumExternalWaits(samples),
      };
      if (p95LocalMs > budgetMs) {
        failures.push(`${metric}-p95-over-budget`);
      }
    }

    return latency;
  }

  private evaluateQuiescentSamples(failures: string[]): void {
    for (const sample of this.#quiescent) {
      if (
        sample.launcherDaemonRssBytes >
        RESOURCE_BUDGETS.launcherDaemonRssBytes
      ) {
        failures.push("launcher-daemon-rss-over-budget");
      }
      if (
        sample.launcherDaemonCpuPercent >
        RESOURCE_BUDGETS.launcherDaemonCpuPercent
      ) {
        failures.push("launcher-daemon-cpu-over-budget");
      }
      if (
        sample.workerRssBytes.some(
          value => value > RESOURCE_BUDGETS.residentWorkerRssBytes,
        )
      ) {
        failures.push("worker-rss-over-budget");
      }
    }
  }

  private evaluateClientSamples(failures: string[]): void {
    for (const sample of this.#clients) {
      if (sample.timelineEntries !== RESOURCE_BUDGETS.timelineEntries) {
        failures.push("timeline-fixture-incomplete");
      }
      if (sample.heapBytes > RESOURCE_BUDGETS.clientHeapBytes) {
        failures.push("client-heap-over-budget");
      }
      if (
        sample.longestNavigationTaskMs > RESOURCE_BUDGETS.responsiveTaskMs
      ) {
        failures.push("timeline-navigation-unresponsive");
      }
    }
  }

  private evaluateSoakSamples(failures: string[]): void {
    for (const sample of this.#soaks) {
      const maximumRssBytes =
        sample.beforeRssBytes *
        (1 + RESOURCE_BUDGETS.soakMemoryGrowthRatio);
      if (sample.afterRssBytes > maximumRssBytes) {
        failures.push("soak-memory-growth>10%");
      }
      if (strictlyIncreasing(sample.handleSamples)) {
        failures.push("soak-handles-monotonic");
      }
      if (sample.diagnosticBytes > RESOURCE_BUDGETS.diagnosticBytes) {
        failures.push("diagnostics-over-budget");
      }
    }
  }
}

function sumExternalWaits(samples: LatencySample[]): ExternalWaitTotals {
  const totals: Record<string, number> = {};

  for (const sample of samples) {
    for (const [name, value] of Object.entries(sample.external ?? {})) {
      totals[name] = (totals[name] ?? 0) + value;
    }
  }

  return totals;
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

function strictlyIncreasing(values: number[]): boolean {
  return (
    values.length > 1 &&
    values.slice(1).every((value, index) => value > values[index]!)
  );
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and nonnegative`);
  }
}
