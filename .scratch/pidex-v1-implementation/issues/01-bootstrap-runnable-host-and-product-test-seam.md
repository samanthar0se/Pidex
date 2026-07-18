# 01 — Bootstrap a runnable Host and product test seam

**What to build:** Establish the thinnest runnable Pidex product: one authoritative Host can start with durable identity, expose status through a real PWA and CLI, and be driven through the approved black-box test seam while deterministic adapters stand in for external Pi and Windows failure behavior.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A developer command starts the real daemon with a real SQLite authority store and serves a minimal PWA plus CLI status surface.
- [ ] The PWA and CLI independently report the same durable Host identity, release identity, readiness state, and synchronization basis.
- [ ] The dominant automated test drives HTTPS/WebSocket product behavior rather than calling authority-kernel internals.
- [ ] Deterministic Pi/model/tool, clock, network, storage, and Windows-platform adapters can be selected by the test harness without changing product contracts.
- [ ] The chosen reversible implementation stack, package boundaries, message encoding, and test tooling are recorded and satisfy the architecture constraints.
- [ ] Restarting the daemon preserves Host identity and committed status while a clean test environment remains isolated and repeatable.
