# 29 — Read a bounded working set offline

**What to build:** Let a paired Device read previously synchronized discovery and Session history while disconnected, with explicit incompleteness/staleness and no Host control until the exact required scopes reconcile atomically.

**Blocked by:** 08 — Resume or reset Client scopes; 13 — Reach complete paginated Session history; 28 — Complete the mobile Session experience

**Status:** resolved

- [ ] A per-Host IndexedDB store transactionally retains lightweight discovery summaries, opened Session projections, mutable-tail basis, fetched finalized pages, and verified immutable blobs.
- [ ] Every cached record retains Host identity, epoch/cursor, protocol/cache schema basis, scope, relevant revisions, and last successful synchronization time.
- [ ] Cached absence never means Host absence, and a cached live entry is visibly the last observed incomplete revision.
- [ ] Offline/reconnecting/update-required/revoked/current state and last sync time remain prominent on desktop and mobile.
- [ ] Every Host mutation is disabled until authentication, protocol basis, Host scope, and target scope are current; cached countdowns and statuses never claim authority.
- [ ] Reconnect resumes or resets through the normal atomic synchronization contract and never merges by timestamp.
- [ ] Pidex discloses that offline coding content may contain sensitive prompts, paths, source, model output, and tool data and adds no separate content-unlock secret.
- [ ] Real-browser tests cover offline launch, partial cache, eviction, stale mutable tail, reconnect reset, another Host, schema incompatibility, and no false currentness.
