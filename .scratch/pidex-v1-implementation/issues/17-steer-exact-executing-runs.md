# 17 — Steer exact executing Runs

**What to build:** Let the developer steer the exact executing Run they observed while ensuring delayed or racing steering can never mutate a successor or become a follow-up.

**Blocked by:** 14 — Negotiate runtime controls; 16 — Queue durable follow-up Runs

**Status:** resolved

- [ ] Steering is capability-gated and targets exact Session, executing Run identity, worker generation, and observed execution state/revision.
- [ ] Accepted steering becomes a durable event inside the target Run and is delivered only to that Run's exact worker execution.
- [ ] Steering arriving after the target ceases executing is rejected as stale with reconciliation information.
- [ ] Pidex never converts stale steering into a follow-up or retargets it to a successor.
- [ ] An executing Run remains executing across accepted steering, model turns, tools, retries, and compaction retries until full settlement.
- [ ] Undelivered steering against an Interrupted Run is recorded as unapplied and cannot migrate to another Run.
- [ ] Tests cover steering/follow-up races, network delay past Run settlement, duplicate command retry, worker loss after acceptance, and exact Timeline representation.
