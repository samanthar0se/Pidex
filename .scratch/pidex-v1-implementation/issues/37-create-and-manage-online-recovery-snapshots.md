# 37 — Create and manage online recovery snapshots

**What to build:** Give the developer automatic recent local recovery points plus manual and risk-boundary snapshots that capture coherent Host barriers, verified Pi checkpoints, independent bytes, conservative retention, and visible Recovery status.

**Blocked by:** 34 — Migrate versioned data and Pi artifacts safely; 36 — Detect and isolate corruption

**Status:** resolved

- [ ] The Host creates at most one scheduled snapshot in each changed 24-hour period, skips unchanged days, and begins a due snapshot within two hours of healthy availability with at most 30 minutes jitter.
- [ ] Upgrade/migration risk boundaries create protected snapshots and paired Devices/CLI can request manual snapshots.
- [ ] A snapshot captures a named synchronization barrier, coherent SQLite snapshot, all referenced immutable objects, and each Session's last verified Pi checkpoint.
- [ ] Snapshot during execution excludes unverified tail; restore semantics for that captured Run are explicitly Interrupted unless later proof exists.
- [ ] Recovery bytes live independently from live-store files; verified content-addressed deduplication may share only recovery objects, never the sole live copy.
- [ ] Retention keeps seven rolling changed-day points, supported rollback points, and manual points until explicit deletion.
- [ ] Recovery UI/CLI expose age, barrier, protected reason, verification, compatibility, storage use, and operation progress/failure.
- [ ] Tests cover unchanged-day skip, missed schedule, executing snapshot, interruption, rotation, deduplication, corrupt object, manual protection, and upgrade boundary.
