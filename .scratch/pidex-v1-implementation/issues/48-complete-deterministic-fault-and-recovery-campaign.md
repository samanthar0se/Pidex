# 48 — Complete the deterministic fault and recovery campaign

**What to build:** Prove Pidex's authority, no-replay, isolation, convergence, settlement, update, backup, restore, security, and corruption guarantees by deterministically injecting failures at every documented boundary.

**Blocked by:** 39 — Restore the whole Host; 41 — Update and roll back signed releases; 45 — Harden product and release security; 47 — Meet latency and resource budgets

**Status:** ready-for-agent

- [ ] The campaign injects faults before/after every command acceptance, dispatch, checkpoint, blob publication, settlement, snapshot barrier, migration activation, release activation, backup verification, restore activation, and Reidentify boundary.
- [ ] Process scenarios cover uncooperative descendants, worker/daemon/launcher termination, Job loss, Host reboot/power loss, startup circuit breaker, and multi-Session isolation.
- [ ] Transport scenarios cover dropped, duplicated, reordered, delayed, coalesced, and slow-Client traffic plus Device-revocation and command/Interaction races.
- [ ] Time/storage scenarios cover wall-clock jumps, disk full, permissions, partial writes, reserve exhaustion, orphan cleanup, and corruption of SQLite, blobs, Pi artifacts, snapshots, manifests, and newest recovery point.
- [ ] Security/operations scenarios cover certificate expiry/rotation, Firewall drift, pairing attacks, malformed IPC/protocol, update download/signature/migration failure, interrupted backup/restore, redaction, and privileged-helper misuse.
- [ ] Every scenario preserves one Host authority, creates no lost/duplicated/reordered/outcome-less accepted work, performs no uncertain replay, and isolates the smallest provably affected scope.
- [ ] Recovery drills pass clean online restore, executing-tail restore, corrupt-newest fallback, failed-migration rollback, identity-preserving portable restore, revocation rollback disclosure, and Reidentify.
- [ ] Blocking fault tests are deterministic; retry may gather diagnostics but cannot convert failed evidence into passing evidence.
