# 13 — Reach complete paginated Session history

**What to build:** Keep reconnect snapshots bounded while letting every authenticated Client reach a Session's complete finalized Timeline through stable HTTP cursor pagination and verified immutable content retrieval.

**Blocked by:** 12 — Stream live Session Timeline entries

**Status:** ready-for-agent

- [ ] A Session scope snapshot contains metadata, current/queued Runs, unresolved Interactions, and a bounded recent Timeline window including the mutable tail.
- [ ] Older finalized entries are reachable through stable cursor pagination with deterministic order and no gaps or duplicates.
- [ ] Large immutable bodies are fetched over authenticated HTTPS with Host-owned metadata and content identity verification.
- [ ] Authenticated Timeline/data responses use `no-store` and are never treated as authoritative through browser HTTP cache behavior.
- [ ] Pagination remains stable while new Timeline entries append and while another Client streams the mutable tail.
- [ ] A Session with 100,000 Timeline entries remains fully reachable without an unbounded snapshot or Client memory load.
- [ ] Tests cover page boundaries, concurrent append, missing/corrupt blob responses, epoch reset, authorization, and complete-history reconstruction from projection plus pages.
