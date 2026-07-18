# 18 — Resolve a basic Interaction

**What to build:** Let a Pi extension request one generic select, confirm, input, or editor Interaction, show it once above the available composer, and return a validated response or dismissal to the exact live worker request.

**Blocked by:** 12 — Stream live Session Timeline entries; 14 — Negotiate runtime controls

**Status:** resolved

- [ ] The Host creates an immutable Interaction with Session, optional Run, worker generation/correlation, kind, bounded inert payload, optional provenance, state, and revision.
- [ ] Only `select`, `confirm`, `input`, and `editor` are response-bearing Interaction kinds; Pidex infers no approval, permission, danger, or durable grant semantics.
- [ ] The selected Session shows one compact Timeline fact and one live response control pinned above the still-usable composer.
- [ ] Select responses equal an offered value, confirm responses are booleans, and input/editor responses satisfy negotiated string bounds.
- [ ] A valid response or explicit Dismiss moves open to resolving and reaches responded/dismissed only after exact-worker acknowledgement.
- [ ] Dismiss affects one Interaction and returns Pi's cancellation/default value without implying Run Stop.
- [ ] Disconnecting, reloading, changing Views, or losing every Client leaves the Interaction open and recoverable from Session snapshots.
- [ ] Tests cover all four kinds, invalid values, dismissal, worker acknowledgement, View loss, unsupported capability, and inert rendering.
