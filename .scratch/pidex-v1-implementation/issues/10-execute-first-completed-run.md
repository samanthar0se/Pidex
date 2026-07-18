# 10 — Execute the first completed Run

**What to build:** Let a paired Client submit the first prompt to an empty or existing Session, durably accept it as a Run, wake one pinned isolated Pi worker, execute through the official SDK boundary, and show a Completed outcome.

**Blocked by:** 09 — Negotiate protocol compatibility and isolate slow Clients

**Status:** resolved

- [ ] First submit from a local New Session View creates the Session and accepts its initial Run as distinguishable durable operations.
- [ ] A prompt becomes a Run only after validation, Session-local identity/order, receipt, and authoritative state commit; rejection before that boundary creates no Run.
- [ ] An accepted action wakes the available sleeping Session and starts exactly one worker immutably bound to that Session and exact bundled Pi SDK generation.
- [ ] Worker readiness probes documented Pi SDK behavior through a versioned schema-validated Pidex protocol and never exposes SDK objects or private Pi format.
- [ ] The worker uses Pi's public resource loader with Host-wide project trust and executes one Run at a time.
- [ ] A deterministic Pi response reaches a minimal Session Timeline and the Run becomes Completed only after required history is durable.
- [ ] Closing, reloading, disconnecting, or losing every Client does not stop the accepted Run.
- [ ] Product and Pi-contract tests cover empty-Session survival after startup failure, missing required worker capability, protocol mismatch, successful completion, and sibling Session isolation.
