# 36 — Detect and isolate corruption

**What to build:** Detect corruption across live and recovery stores, repair only from proven exact copies, isolate the smallest trustworthy scope, and enter Host-local recovery when global authority cannot be trusted.

**Blocked by:** 34 — Migrate versioned data and Pi artifacts safely; 35 — Protect accepted work under storage pressure

**Status:** resolved

- [ ] Low-priority incremental scrubbing covers SQLite, immutable blobs, Pi checkpoint evidence, data generations, recovery objects/manifests, and backup catalog with monthly online retained-byte coverage.
- [ ] A missing/corrupt immutable object repairs automatically only from independently verified provenance and cryptographic byte identity.
- [ ] Repair quarantines damage, materializes/verifies replacement, activates atomically, and records source/evidence.
- [ ] Unprovable blob/artifact damage isolates the smallest affected Session/content scope while unaffected Host functions remain available.
- [ ] Corrupt SQLite, Host identity, Device authorization, or another global authority invariant disables LAN product service and mDNS and enters Host-local recovery mode.
- [ ] Recovery mode accepts no previously paired Device while authorization is uncertain and remains available only through signed CLI/localhost launch capability.
- [ ] Approximate reconstruction, timestamp choice, silent rollback, row guessing, and last-write-wins repair are forbidden.
- [ ] Corruption tests cover every store/generation/manifest, newest-copy damage, partial repair, repeat scrub, global/local distinction, and visible diagnostics.
