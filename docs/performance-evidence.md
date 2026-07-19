# Performance release evidence

Issue 47 is a release gate, not a claim based on unit-test timing. Run the
packaged release on each supported capacity tier and required browser mode.
Record evidence with `PerformanceGate`
(`packages/host/src/performance-budgets.ts`) and archive the resulting
`pidex-performance-v1` JSON beside the exact build.

## Reproduction protocol

1. Start from an idle, rebooted supported Host and record build digest,
   OS/browser versions, physical memory and configuration. Shape Client traffic
   to **50 ms RTT and 1% loss** (a lower measured value is also valid).
2. Use at least 20 independent observations per latency metric, including
   cold/warm shell, cached/uncached recent Session open, command outcome,
   projection reconciliation, live output after Host receipt, reconnect,
   worker wake, and daemon readiness. Record monotonic timestamps at the named
   boundaries; do not substitute test-runner wall time.
3. Put only Pidex processing in `localMs`. Record provider, tool, user-media,
   Push, and backup-destination waits in their named `external` fields. The
   report sums and displays these waits but does not charge them to a local p95.
4. At equivalent quiescence, sample launcher+daemon RSS and average CPU for five
   minutes and each resident worker RSS. Exercise navigation with the
   100,000-entry Timeline fixture while recording browser JS heap and longest
   navigation task.
5. Before and after soak, return to equivalent quiescence and record RSS,
   diagnostic/crash bytes, and a time series of OS handles. Growth over 10%,
   strictly increasing handles, artifacts over 1 GiB, or any resource threshold
   fails.
6. Add the authority/correctness assertions exercised by the run. Missing or
   false assertions fail even when timings pass. Run `npm run typecheck` and
   `npm test`, then retain raw traces, the JSON report, traffic-shaper
   configuration, and test logs.

The gate uses nearest-rank p95 and the constants in source. Do not trim
outliers, retry a failed sample into a pass, weaken synchronization, skip
durable outcomes, or render fewer Timeline entries. External browser/OS/hardware
measurements remain release artifacts and must not be inferred from unit tests.
