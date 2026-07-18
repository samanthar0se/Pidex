# 42 — Diagnose the Host and export support evidence

**What to build:** Give the developer actionable local CLI, Recovery, diagnostics, logs, events, and support evidence for startup, identity, network, worker, storage, update, backup, restore, and corruption failures without automatically exporting coding content.

**Blocked by:** 03 — Discover and expose the Host on the Private LAN; 36 — Detect and isolate corruption; 40 — Reidentify verified data without trust keys; 41 — Update and roll back signed releases

**Status:** resolved

- [ ] The signed `pidex` CLI supports status, start, retry, pairing, revocation, origin/certificate/firewall inspection/repair, update, logs, backup/recovery, and support export.
- [ ] `pidex doctor` checks launcher/daemon versions, circuit breaker, database/migrations, certificates/expiry, canonical resolution/port, Firewall/profile, mDNS, update staging, Jobs/workers, and storage health.
- [ ] CLI can open localhost setup/recovery only with a short-lived single-use launch capability that ordinary web origins cannot invoke ambiently.
- [ ] Structured rotating logs and crash artifacts remain within the configured aggregate 1 GB default bound; Windows events contain only coarse lifecycle/failure facts.
- [ ] Startup, health, maintenance, and recovery surfaces expose typed actionable causes and bounded progress or typed failure.
- [ ] Support bundles redact secrets, prompts, conversation content, tool payload/output, and sensitive paths by default; adding content requires explicit export choice.
- [ ] Pidex sends no telemetry, logs, crash reports, or support bundles off the Host automatically.
- [ ] Tests seed each diagnostic condition, verify consistent PWA/CLI/doctor reporting, prove launch-capability resistance, enforce rotation, and scan default exports for forbidden content.
