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

interface GateMetadata {
  build: string;
  environment: { os: string; browser: string; memoryBytes: number };
  network: { rttMs: number; lossPercent: number };
}

interface LatencySample {
  localMs: number;
  external?: Partial<Record<ExternalWait, number>>;
}

interface QuiescentSample {
  launcherDaemonRssBytes: number;
  launcherDaemonCpuPercent: number;
  workerRssBytes: number[];
}

interface ClientSample {
  timelineEntries: number;
  heapBytes: number;
  longestNavigationTaskMs: number;
}

interface SoakSample {
  beforeRssBytes: number;
  afterRssBytes: number;
  handleSamples: number[];
  diagnosticBytes: number;
}

export interface PerformanceEvidence {
  schema: "pidex-performance-v1";
  metadata: GateMetadata;
  latency: Partial<Record<LatencyMetric, {
    samples: number;
    p95LocalMs: number;
    budgetMs: number;
    external: Partial<Record<ExternalWait, number>>;
  }>>;
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

  constructor(readonly metadata: GateMetadata) {
    if (!metadata.build || !metadata.environment.os || !metadata.environment.browser) {
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

  recordQuiescent(sample: QuiescentSample): void { this.#quiescent.push(sample); }
  recordClient(sample: ClientSample): void { this.#clients.push(sample); }
  recordSoak(sample: SoakSample): void { this.#soaks.push(sample); }
  assertAuthority(name: string, preserved: boolean): void {
    if (!name) throw new Error("authority-assertion-name-required");
    this.#authority.set(name, preserved);
  }

  evaluate(): PerformanceEvidence {
    const failures: string[] = [];
    const latency: PerformanceEvidence["latency"] = {};
    if (this.metadata.network.rttMs > 50 || this.metadata.network.lossPercent > 1) {
      failures.push("unsupported-network-condition");
    }
    for (const [metric, samples] of this.#latencies) {
      const p95LocalMs = percentile95(samples.map(sample => sample.localMs));
      const external: Partial<Record<ExternalWait, number>> = {};
      for (const sample of samples) for (const [name, value] of Object.entries(sample.external ?? {})) {
        const key = name as ExternalWait;
        external[key] = (external[key] ?? 0) + value;
      }
      latency[metric] = { samples: samples.length, p95LocalMs, budgetMs: LATENCY_BUDGETS_MS[metric], external };
      if (p95LocalMs > LATENCY_BUDGETS_MS[metric]) failures.push(`${metric}-p95-over-budget`);
    }
    for (const sample of this.#quiescent) {
      if (sample.launcherDaemonRssBytes > RESOURCE_BUDGETS.launcherDaemonRssBytes) failures.push("launcher-daemon-rss-over-budget");
      if (sample.launcherDaemonCpuPercent > RESOURCE_BUDGETS.launcherDaemonCpuPercent) failures.push("launcher-daemon-cpu-over-budget");
      if (sample.workerRssBytes.some(value => value > RESOURCE_BUDGETS.residentWorkerRssBytes)) failures.push("worker-rss-over-budget");
    }
    for (const sample of this.#clients) {
      if (sample.timelineEntries !== RESOURCE_BUDGETS.timelineEntries) failures.push("timeline-fixture-incomplete");
      if (sample.heapBytes > RESOURCE_BUDGETS.clientHeapBytes) failures.push("client-heap-over-budget");
      if (sample.longestNavigationTaskMs > RESOURCE_BUDGETS.responsiveTaskMs) failures.push("timeline-navigation-unresponsive");
    }
    for (const sample of this.#soaks) {
      if (sample.afterRssBytes > sample.beforeRssBytes * (1 + RESOURCE_BUDGETS.soakMemoryGrowthRatio)) failures.push("soak-memory-growth>10%");
      if (strictlyIncreasing(sample.handleSamples)) failures.push("soak-handles-monotonic");
      if (sample.diagnosticBytes > RESOURCE_BUDGETS.diagnosticBytes) failures.push("diagnostics-over-budget");
    }
    const authorityAssertions = Object.fromEntries(this.#authority);
    if (this.#authority.size === 0 || [...this.#authority.values()].some(value => !value)) failures.push("authority-assertions-not-preserved");
    const uniqueFailures = [...new Set(failures)];
    return { schema: "pidex-performance-v1", metadata: this.metadata, latency, authorityAssertions, failures: uniqueFailures, passed: uniqueFailures.length === 0 };
  }
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

function strictlyIncreasing(values: number[]): boolean {
  return values.length > 1 && values.slice(1).every((value, index) => value > values[index]!);
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and nonnegative`);
}
