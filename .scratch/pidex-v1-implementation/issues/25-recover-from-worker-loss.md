# 25 — Recover from worker loss

**What to build:** Reconcile one Session after its worker exits, hangs, or loses IPC, using durable acceptance, Pi artifact, and checkpoint evidence to preserve proven results, interrupt uncertainty, and hold safe continuation.

**Blocked by:** 17 — Steer exact executing Runs; 21 — Force-stop an uncooperative Session tree; 22 — Sleep and wake Sessions at quiescence

**Status:** resolved

- [ ] Worker exit or IPC loss completes every pending worker request with a typed failure and affects only the bound Session.
- [ ] Recovery compares durable Run acceptance, worker checkpoint evidence, and the Pi artifact through the matching pinned worker boundary.
- [ ] Proven Completed, Failed, or Cancelled settlement is finalized; unproved executing work becomes Interrupted and is never replayed.
- [ ] Partial recovered output/history remains attached to the Interrupted Run with a visible recovery fact.
- [ ] Proven-undispatched follow-ups remain accepted but held; undelivered steering is recorded unapplied and cannot migrate.
- [ ] Every unresolved Interaction for the lost worker generation becomes withdrawn, including accepted-but-unacknowledged response evidence.
- [ ] The Session ends sleeping until explicit work wakes a replacement worker; sibling Sessions remain resident/executing as applicable.
- [ ] Fault tests inject exit, hang, malformed IPC, channel loss, checkpoint corruption, and loss at every dispatch/settlement point.
