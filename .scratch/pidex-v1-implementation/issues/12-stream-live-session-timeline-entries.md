# 12 — Stream live Session Timeline entries

**What to build:** Show live prompt, assistant/model, tool, and Run activity as a Host-owned Session Timeline whose mutable tail advances by revisioned typed changes and becomes immutable at finalization.

**Blocked by:** 11 — Settle every Run outcome durably

**Status:** resolved

- [ ] Timeline entries have stable identities, order keys, optional Run association, monotonic revisions, and schema-defined content rather than Pi SDK objects.
- [ ] Prompts, model/assistant output, tool activity, Run boundaries, outcomes, and user-visible lifecycle/recovery facts share one ordered product projection.
- [ ] Output deltas state required base and resulting revision; mismatch makes the Session scope non-current and triggers reset.
- [ ] The Host may coalesce runtime output without preserving token boundaries while snapshots always contain consolidated current entries.
- [ ] Finalization makes an entry immutable; corrections or later recovery facts append new entries rather than rewriting history.
- [ ] Live output reaches a current Client within the release latency budget after Host receipt under the supported LAN baseline.
- [ ] Product tests cover interleaved tool/model output, coalescing, duplicate/reordered deltas, reconnect during streaming, finalization, and correction append.
