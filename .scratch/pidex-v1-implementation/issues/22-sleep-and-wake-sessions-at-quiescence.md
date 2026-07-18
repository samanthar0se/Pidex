# 22 — Sleep and wake Sessions at quiescence

**What to build:** Load Pi only for accepted work that needs it and dispose a Session worker only after the Host proves a fully flushed quiescent boundary, independently of every Client View.

**Blocked by:** 21 — Force-stop an uncooperative Session tree

**Status:** ready-for-agent

- [ ] Reading, opening, selecting, replacing, reloading, or closing a Session View does not wake or sleep the Session.
- [ ] An accepted Pi-requiring action demand-wakes an available sleeping Session and makes its worker ready within the release budget.
- [ ] Explicit or automatic Sleep is rejected while any Run is executing, queued, held, or cancelling; any Interaction is unresolved; or retry, compaction, or lifecycle work remains.
- [ ] Successful Sleep flushes required state/checkpoint evidence before disposing the worker and leaves retention unchanged.
- [ ] An idle worker crash makes the Session sleeping without changing durable history; opening the Session remains worker-free.
- [ ] Host restart does not automatically wake formerly resident Sessions except for bounded reconciliation work.
- [ ] Tests cover last-View closure, concurrent wake commands, quiescence races, flush failure, idle worker loss, repeated sleep/wake, and no lifecycle coupling.
