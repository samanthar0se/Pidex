# Soak, daily-driver, and release promotion evidence (PRD: Build Pidex v1)

`ReleasePromotion` (`packages/host/src/release-promotion.ts`) is the final
fail-closed manifest. Unit tests validate the evaluator; they are not soak,
browser, hardware, installer, or daily-use evidence.

For the exact signed build, archive a `pidex-release-promotion-v1` report and
all referenced raw artifacts. Every soak and trial record must name the build
digest, exact OS/hardware/browser environment, configuration digest, and
content-addressed logs/traces.

## Release protocol

1. On both the 8 GiB and 16 GiB capacity tiers, run the packaged product for at
   least 72 continuous hours at the section 17 scale. Exercise accepted work,
   failures, reconnects, multiple Clients, maintenance, and pressure. Any
   invariant violation, daemon crash, stuck accepted work, incorrect Client
   convergence, unbounded queue growth, or resource-limit failure blocks.
2. Return each Host to equivalent quiescence. Record before/after RSS, OS handle
   time series, diagnostics size, queue traces, crash records, and authority
   assertions. More than 10% memory growth, monotonically growing handles, or
   diagnostics above 1 GiB blocks.
3. Use desktop and mobile Pidex Clients for seven real consecutive days of core
   Pi work. Record accepted and unique terminal counts for prompts, steering,
   follow-ups, Interaction Responses, Stops, Timeline settlements, and
   maintenance. Record that no core Session action used another Pi UI.
4. Exercise clean install; every release declared supported for upgrade;
   rollback before mutation acceptance; uninstall/reinstall with preserved
   data; required browsers/capacities; security automation; bundled Pi
   contracts; deterministic fault/recovery; soak; and daily-driver evidence.
5. Triage all defects. Severity 1/2 and every explicit hard-gate failure block.
   An open Severity 3 needs a safe workaround, bounded scope, owner, and
   follow-up. A browser/OS waiver is valid only for an external defect with a
   safe fallback that weakens no correctness, security, authority, integrity,
   or recovery guarantee.
6. For every later code, dependency, schema, installer, signing, or
   configuration change, record impact analysis and rerun every plausibly
   affected gate. A rerun is new evidence; it cannot rewrite a failed run.

Promotion states the product boundary literally: v1 makes no WCAG conformance,
automatic telemetry, penetration-test, or worker-security-sandbox claim.
Accessibility still blocks when it breaks a required workflow/browser gate;
observability is the typed local diagnostics, bounded logs, CLI, doctor, and
Recovery behavior specified by the PRD.
