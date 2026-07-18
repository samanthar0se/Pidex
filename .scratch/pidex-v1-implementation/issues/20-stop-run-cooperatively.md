# 20 — Stop a Run cooperatively

**What to build:** Let the developer Stop the exact executing Run they observed, cancel all undelivered continuation in that Session, withdraw associated Interactions, and settle cooperatively through Pi without changing unrelated work.

**Blocked by:** 16 — Queue durable follow-up Runs; 17 — Steer exact executing Runs; 19 — Resolve Interaction races, deadlines, and redaction

**Status:** resolved

- [ ] Stop targets exact Session, executing Run, observed state/revision, and worker generation; a target that already ended is rejected as stale.
- [ ] Accepted Stop moves the Run through visible cancellation and cancels every undelivered steering event and queued/held follow-up Run in the Session.
- [ ] Stop withdraws open/resolving Interactions associated with that Run but leaves unrelated Session-level command Interactions unchanged.
- [ ] The worker clears transient queues, propagates Pi cooperative abort, and allows built-in tool process settlement.
- [ ] Cancellation completes only after the worker is idle or dead and Host state/checkpoint evidence reconciles durably.
- [ ] Cooperative success produces Cancelled, preserves partial Timeline/output and committed side effects, and never claims rollback.
- [ ] The PWA keeps exact-target Stop directly visible while execution continues and reconciles stale races across Devices.
- [ ] Tests cover Stop after successor race, queued continuation cancellation, Interaction deadline race, command retry, cooperative tool cleanup, and sibling Session independence.
