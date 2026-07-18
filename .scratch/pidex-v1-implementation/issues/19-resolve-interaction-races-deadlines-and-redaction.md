# 19 — Resolve Interaction races, deadlines, and redaction

**What to build:** Make several Interactions and Devices race safely under Host-authoritative deadlines, exact-request acknowledgement, terminal-cause reconciliation, and strict removal of free-form response plaintext.

**Blocked by:** 08 — Resume or reset Client scopes; 18 — Resolve a basic Interaction

**Status:** ready-for-agent

- [ ] A Session can hold several independent open Interactions, and the pinned UI orders timed requests by earliest deadline then untimed requests by creation order.
- [ ] Any paired Device may respond; the first valid Host commit reserves the exact Interaction revision/worker generation and later competitors are stale.
- [ ] Only extension-declared timeout creates one absolute Host deadline; reconnect, Device changes, and Client timers never restart or extend it.
- [ ] The Host serializes response, dismissal, deadline, withdrawal, and applicable Stop races into exactly one terminal state: responded, dismissed, expired, or withdrawn.
- [ ] If a response is accepted but exact-worker application is unproved before loss/withdrawal, the Interaction becomes withdrawn and the value is never replayed.
- [ ] Confirm/select answers may remain durable, while acknowledged input/editor plaintext is excluded from Timeline, receipts, command results, diagnostics, logs, and Device cache.
- [ ] Every subscribed Client reconciles request state, deadline, terminal cause, response time, and responding Device label through Host Change Sets.
- [ ] Deterministic multi-Device and clock-jump tests cover every race ordering, untimed persistence, worker loss, Run settlement waiting, and plaintext absence.
