# 39 — Restore the whole Host

**What to build:** Let an authorized developer explicitly replace the entire Host from the newest verified compatible recovery source, with complete preflight disclosure, safe generation activation, Device/revocation semantics, and no automatic replay or merge.

**Blocked by:** 26 — Recover from daemon or Host loss; 32 — Clean revoked Devices and manage cache storage; 36 — Detect and isolate corruption; 37 — Create and manage online recovery snapshots; 38 — Export and verify a portable backup

**Status:** ready-for-agent

- [ ] While normal authority is valid, any paired Device can request revision-preconditioned whole-Host restore; in global recovery mode only Host-local CLI/localhost recovery can do so.
- [ ] Preflight fully verifies current source bytes, encryption, identity, manifest/reference closure, version compatibility, and required migrations before materialization.
- [ ] Local candidates are checked newest-first; preview identifies skipped failures, rollback range, affected Runs, captured Devices/revocations, identity/origin, collision risk, and migration needs.
- [ ] Restore never merges, selectively imports, clones, or starts automatically; explicit confirmation is required and older/identity-changing paths use stronger confirmation.
- [ ] The stopped daemon materializes, migrates, verifies, and atomically activates a new generation while preserving the replaced/damaged generation.
- [ ] Every activation rotates synchronization epoch, invalidates old cursors, and forces all Clients to reset.
- [ ] Captured executing/cancelling Runs become Interrupted, worker Interactions become withdrawn, and queued Runs remain accepted but held until review/release.
- [ ] Captured Device authorization restores exactly, with explicit warning that a Device revoked after the point can become Paired again.
- [ ] Failure before new mutation acceptance safely returns to the prior generation where possible; later rollback requires another managed restore.
