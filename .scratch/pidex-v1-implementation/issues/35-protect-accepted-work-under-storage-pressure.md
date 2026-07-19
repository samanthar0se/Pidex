# 35 — Protect accepted work under storage pressure

**What to build:** Preserve emergency write capacity for already accepted work and critical authority changes by cleaning only safe disposable data and rejecting discretionary growth before arbitrary disk failures begin.

**Blocked by:** 33 — Retain and garbage-collect durable stores safely

**Status:** resolved

- [ ] Pidex reserves configurable emergency headroom for SQLite/WAL, accepted Run settlement, cancellation evidence, revocation, maintenance bookkeeping, and recovery diagnostics.
- [ ] Admission control begins before reserve use and reports pressure with actionable context rather than relying on best-effort writes.
- [ ] Automatic pressure cleanup is limited to proven abandoned staging, two-pass orphans, expired diagnostics/caches, unsupported rollback generations, and unprotected snapshots outside retention.
- [ ] Cleanup never deletes authoritative Sessions, Timeline, required blobs/artifacts, minimum receipt/change windows, protected rollback points, or manual snapshots.
- [ ] Storage-protection mode rejects discretionary growth such as new Runs, Forks, uploads, and pairing while preserving reads and essential settlement/Stop/revocation/cleanup/diagnostic writes.
- [ ] The PWA/CLI explain rejected operations and link to storage/recovery actions without presenting unaffected reads as unavailable.
- [ ] Chosen reserve and pressure thresholds are recorded and validated against supported capacity tiers.
- [ ] Fault tests fill disk at acceptance, dispatch, blob publication, settlement, revocation, cleanup, and recovery boundaries and prove no authority loss.
