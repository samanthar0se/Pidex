# 34 — Migrate versioned data and Pi artifacts safely

**What to build:** Move Host authority to a new schema/release generation without corrupting the old generation, and migrate each Pi artifact lazily through the matching pinned worker while keeping unaffected history readable.

**Blocked by:** 33 — Retain and garbage-collect durable stores safely

**Status:** ready-for-agent

- [ ] A data-changing migration preflights release/schema compatibility, integrity, required free space, and protected recovery basis before stopping mutations/workers.
- [ ] SQLite migration materializes in a new versioned data generation and activates atomically only after deterministic migration and full validation.
- [ ] Failure before activation leaves the prior release/generation runnable and does not partially rewrite authoritative stores.
- [ ] Pi artifacts retain source Pidex/Pi version metadata and are never bulk-rewritten or migrated in place.
- [ ] First wake under a new release copy-migrates through the new pinned worker, protects the source artifact, and activates only after a verified stable checkpoint.
- [ ] A failed Pi artifact migration isolates that Session with typed diagnostics while its Host Timeline and unrelated Sessions remain readable.
- [ ] Every possible continuity rollback rotates synchronization epoch or otherwise forces authoritative Client reset.
- [ ] Migration tests cover every supported prior schema, malformed/old artifacts, disk/permission failure, crash at each activation point, rollback, and mixed-version prevention.
