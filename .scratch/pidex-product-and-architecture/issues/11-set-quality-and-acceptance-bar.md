Type: grilling
Status: resolved
Assignee: pi
Blocked by: 04, 05, 06, 07, 08, 09, 10, 13, 14, 15

## Question

What performance, reliability, security, accessibility, browser-support, observability, recovery-test, and release-acceptance criteria must the implementation satisfy?

## Comments

This decision was resolved through a live grilling session. It adds no new domain term to [`../CONTEXT.md`](../CONTEXT.md).

## Answer

### Release-gate policy

Pidex v1 uses hard release gates. Every required criterion below must have valid passing evidence before release. A narrow waiver is permitted only for a documented external browser or operating-system defect when Pidex provides a safe fallback and the waiver weakens no correctness, security, authority, data-integrity, or recovery guarantee.

Evidence may accumulate across builds during the release milestone rather than belonging to one immutable candidate, but every result records its exact build, environment, configuration, and artifacts. Every later code, dependency, schema, configuration, installer, or signing change receives documented impact analysis and reruns every plausibly affected gate. Unaffected evidence remains valid only through that traceability.

Blocking tests must be deterministic. A retry may gather diagnostics but cannot turn a failed blocking run into passing evidence. A flaky or quarantined test supplies no evidence for its criterion until its cause is fixed or the faulty test is corrected and rerun.

### Supported environments and capacity

The Host quality floor is a Microsoft-supported Windows 11 x64 release on an SSD-equipped system with at least four hardware threads, 8 GB RAM, and 10 GB free space at installation and test start. Interactive network targets are measured on a LAN with no more than 50 ms round-trip latency and 1% packet loss. Lower-spec or worse-network environments may work but do not receive the release guarantee.

The blocking browser matrix at release time is the current and previous major version of:

- Microsoft Edge and Google Chrome on supported Windows;
- Google Chrome on supported Android; and
- Safari in browser and installed standalone-PWA modes on supported iOS and iPadOS.

Firefox and other browsers are best-effort in v1. An unsupported or incompatible browser must fail clearly without presenting a partially current or controllable product.

All tiers test 10,000 retained Sessions, discovery across that set, one 100,000-entry Session Timeline, and six simultaneous Clients across three Devices. An 8 GB Host must meet every target with four resident Sessions and two concurrently executing Runs. A 16 GB Host must meet them with eight resident Sessions and four concurrently executing Runs. These are tested capacity floors, not artificial caps: Pidex admits further work according to measured resources, preserves operating-system headroom, and reports capacity pressure instead of silently paging, dropping work, or imposing a persistent-Session limit.

### Performance and resource gates

Under the applicable capacity tier and network baseline, end-to-end p95 latency must satisfy:

- cold app launch to a usable shell within 3 seconds and warm launch within 1 second;
- switching to a cached Session within 300 milliseconds and opening an uncached recent Session within 2 seconds;
- returning a Host command outcome within 250 milliseconds and reconciling the authoritative Client projection within 500 milliseconds;
- displaying live output within 250 milliseconds after the Host receives it;
- restoring a resumable Client connection to current state within 3 seconds;
- making a sleeping Session worker ready within 5 seconds; and
- declaring normal daemon readiness within 15 seconds.

These budgets exclude upstream model-provider latency, tool execution, user-controlled media, Web Push delivery, and backup destination I/O. Pidex must expose those waits distinctly rather than charging them to or hiding them inside a local operation.

Excluding browser-process overhead and tool or model child processes outside Pidex's direct control:

- the quiescent launcher and daemon together use no more than 300 MB RSS and average no more than 1% CPU;
- each quiescent resident worker uses no more than 300 MB RSS;
- a Client displaying the 100,000-entry Timeline uses no more than 300 MB JavaScript heap;
- rotating diagnostics and crash artifacts consume no more than 1 GB under the default policy; and
- after the 72-hour soak returns to the same quiescent workload, handles show no monotonic growth and memory has grown by no more than 10%.

### Runtime compatibility and correctness

Every release runs a blocking compatibility and contract suite against the exact bundled Pi SDK version, not merely recorded worker-protocol fixtures. Deterministic fake models, tools, extensions, Interactions, cancellation, retries, compaction, malformed messages, process loss, and capability combinations exercise every required Pidex-to-Pi behavior. A missing required capability, changed required semantic, schema mismatch, or unrecognized required message blocks worker readiness and release. Real-provider smoke tests are useful but advisory because credentials, quota, network, and provider behavior are external.

Across all tests there may be no lost, duplicated, reordered, silently replayed, or outcome-less accepted Command, Run, steering event, follow-up, Interaction Response, cancellation, Timeline settlement, or maintenance operation. Every Client that reports itself current must equal the Host projection for its synchronized scopes.

### Reliability and fault campaign

Each release milestone must supply all three layers of reliability evidence:

1. A comprehensive deterministic fault matrix injects failures at every documented acceptance, dispatch, checkpoint, settlement, snapshot, migration, activation, and restore boundary.
2. A 72-hour automated soak at the applicable capacity tier completes with zero invariant violations, daemon crashes, stuck accepted work, incorrect Client convergence, unbounded queue growth, or resource-limit violations.
3. A seven-day real daily-driver trial performs core Pi work from desktop and mobile Pidex Clients without returning to another Pi UI for a core Session action and with no Severity 1 or Severity 2 defect.

The mandatory matrix covers uncooperative workers and descendants; worker, daemon, and launcher termination; Host reboot and power loss; dropped, duplicated, reordered, delayed, and slow-Client traffic; Device-revocation races; wall-clock jumps around Interaction deadlines; disk-full, permission, and partial-write faults; corrupt SQLite, blob, Pi-artifact, snapshot, and recovery generations; certificate expiry and rotation; firewall drift; update download, verification, activation, and migration failures; interrupted backup and restore; and corruption of the newest recovery point. Every scenario must preserve Host authority, avoid uncertain replay, produce the specified terminal or recovery state, and isolate the smallest provably affected scope.

Operational timing is fixed as follows:

- accepted Stop permits 10 seconds for cooperative settlement, then terminates the affected Session Job and allows 5 seconds to reconcile the result;
- each normal launcher start has a 15-second readiness deadline; failed starts use at most five bounded restart attempts with 1, 2, 4, 8, and 16-second backoff before the circuit breaker opens;
- heartbeat loss becomes suspect after 10 seconds and disconnected after 30 seconds;
- non-forced stop, restart, update, uninstall, and portable-backup drains wait up to 15 minutes, then abort the operation and resume normal acceptance rather than escalating silently;
- Windows shutdown receives a 10-second bounded flush and cooperative-abort budget before Job closure handles the remainder; and
- a due changed-day recovery snapshot begins within 2 hours after a healthy Host is available, with scheduling jitter capped at 30 minutes.

### Security gate

The release maintains a threat model and maps applicable automated controls to OWASP ASVS Level 2. Blocking automation covers secret scanning, dependency and known-vulnerability scanning, static analysis, protocol and schema fuzz/property tests, TLS and canonical-origin enforcement, pairing-secret limits, Device challenge authentication and revocation, authorization of every protected surface, CSRF and cross-origin resistance, local-control launch capabilities, privileged-helper input restrictions, update signatures, backup encryption, IPC validation, and support-bundle and log redaction.

Every shipped artifact is signed and has an SBOM tied to that artifact. No known critical or high vulnerability may ship. A medium finding requires documented scope, compensating controls, ownership, and explicit acceptance. V1 does not require an independent manual security review or external penetration test. This assurance does not recast Session workers as security sandboxes; it tests the explicitly chosen Host trust boundary and worker reliability isolation.

### Accessibility and observability boundaries

V1 has no blocking accessibility conformance target or manual assistive-technology test matrix and makes no WCAG conformance claim. Accessibility findings do not block release unless they independently violate another required workflow or supported-browser criterion.

Observability acceptance is deliberately minimal. Startup and health checks must expose actionable typed failures, and local structured logs and rotating crash artifacts must remain within their bounds and pass automated secret and content-redaction tests. Existing `pidex doctor`, recovery, CLI, and diagnostics behavior remains functionally required, but v1 adds no blocking metrics, distributed-correlation, telemetry, or formal operator-diagnosis drill beyond the fault tests' required visible outcomes.

### Backup and recovery acceptance

Recovery is outcome-gated rather than assigned a fixed restore-time objective. Every release must pass clean online-snapshot restore, interrupted restore, corrupt-newest-point fallback, failed-migration rollback, identity-preserving portable restore, and Reidentify drills, along with the storage and corruption cases in the comprehensive fault matrix. Each operation must report bounded progress or a typed failure, preserve the previous generation until safe activation, rotate synchronization authority where required, and never silently roll back, merge Hosts, revive uncertain intent, or claim unverified bytes.

The changed-day snapshot schedule and operational start deadline above define the local recovery cadence. V1 sets no additional fixed completion deadline for snapshot creation, portable verification, recovery-mode entry, or whole-Host restore.

### Defect and promotion bar

Milestone promotion exercises clean install, upgrade from every still-supported prior release, rollback before the new release accepts mutations, uninstall and reinstall with durable-data preservation, the full browser and capacity matrix, security automation, deterministic Pi contracts, the fault and recovery suites, soak, and daily-driver trial. Results may come from different traced builds only under the impact-based revalidation rule.

No open Severity 1 or Severity 2 defect may ship:

- **Severity 1** includes authority loss, duplication or corruption; unauthorized control or secret exposure; unsafe update or restore; or Host-wide unrecoverability.
- **Severity 2** includes an unavailable core workflow, a Client claiming an incorrect current state, failure isolation breaking across Sessions or Clients, a repeatable daemon or Client crash, or failure on a required browser or capacity tier.

A Severity 3 defect may ship only with a documented safe workaround, bounded scope, owner, and follow-up. Severity 4 cosmetic defects may ship. Any failure of an explicit hard criterion blocks release regardless of its assigned severity.
