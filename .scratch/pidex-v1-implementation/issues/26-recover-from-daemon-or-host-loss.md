# 26 — Recover from daemon or Host loss

**What to build:** Restart the authoritative Host after unexpected daemon termination, reboot, or power loss and conservatively reconstruct every accepted Session/Run without losing, duplicating, or automatically replaying intent.

**Blocked by:** 25 — Recover from worker loss

**Status:** resolved

- [ ] The launcher owns a kill-on-close daemon supervision Job whose loss tears down contained worker trees rather than orphaning execution.
- [ ] Startup validates durable Host state and reconciles every Run recorded as executing/cancelling against artifacts and checkpoint evidence before normal mutation readiness.
- [ ] Proven terminal outcomes finalize; every unproved executing/cancelling Run becomes Interrupted with partial history retained.
- [ ] Accepted queued Runs proven never dispatched remain held for explicit review/release after abnormal predecessor outcomes.
- [ ] Ordinary restart preserves Host identity and synchronization continuity unless reconciliation proves a continuity-breaking epoch rotation is required.
- [ ] No command, Run, steering event, Interaction Response, or external mutation is replayed merely to discover whether it committed.
- [ ] Host discovery/read access becomes ready only after global authority is safe, while isolated Session failures remain scoped and visible.
- [ ] Fault tests cover daemon kill, launcher loss, reboot, simulated power loss, WAL recovery, worker teardown, repeated startup failure, and multi-Session convergence.
