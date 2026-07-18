# 16 — Queue durable follow-up Runs

**What to build:** Let the developer create ordered follow-up Runs while one Run executes, with the Host owning durable queue identity and dispatching each only after a normally Completed predecessor.

**Blocked by:** 11 — Settle every Run outcome durably

**Status:** ready-for-agent

- [ ] A follow-up command creates a separate accepted queued Run with Host-assigned Session-local identity/order and durable receipt.
- [ ] The daemon queue is authoritative; Pi's transient in-memory follow-up queue is not used as durable state.
- [ ] One Session still executes at most one Run, and the next queued Run dispatches only after its predecessor becomes Completed.
- [ ] Failed or Interrupted predecessors leave proven-undispatched follow-ups queued and held for explicit release or cancellation.
- [ ] A held Run never dispatches automatically after reconnect, worker replacement, daemon restart, or Host restart.
- [ ] The PWA distinguishes executing, queued, and held Runs and presents follow-up as a secondary action.
- [ ] Tests cover multiple queued Runs, restart between acceptance and dispatch, predecessor failure/interruption, explicit release/cancel, and no loss/duplication/reordering.
