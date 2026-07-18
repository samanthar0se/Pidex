# 30 — Preserve drafts and update the service worker safely

**What to build:** Preserve Device-owned Composer Drafts independently from replaceable offline projections and update complete PWA shell/cache generations without mixed versions, silent draft loss, or background authority.

**Blocked by:** 29 — Read a bounded working set offline

**Status:** ready-for-agent

- [ ] Composer Drafts live in storage separate from disposable projections and remain local/unsent across reload, offline use, projection reset, and cache eviction.
- [ ] No reconnect, service-worker event, Background Sync, notification action, or page launch automatically submits a draft or creates a Host command.
- [ ] Draft persistence/migration failure warns immediately and remains visible while the text is still in memory.
- [ ] The service worker installs one content-addressed complete shell generation before it becomes eligible to activate.
- [ ] A waiting shell activates only after explicit reload or every older Client closes, after Clients attempt to persist Device-owned state.
- [ ] Cache-schema migration is versioned and atomic; failed replaceable-projection migration resets data, while signing keys, preferences, and drafts are not silently discarded.
- [ ] The service worker owns only shell/offline fallback, Push receipt, notification routing, and obsolete-shell cleanup—not live connections, synchronization, order, or commands.
- [ ] Browser tests cover update with multiple Clients, reload refusal, schema failure, suspended/terminated workers, draft write failure, and no mixed old-page/new-worker authority.
