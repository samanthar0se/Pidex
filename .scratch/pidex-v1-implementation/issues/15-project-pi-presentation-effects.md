# 15 — Project Pi presentation effects

**What to build:** Render Pi notifications, keyed status, widgets, titles, and editor-text injection as bounded worker-generation presentation effects without turning them into Interactions, Session identity, or shared authoritative drafts.

**Blocked by:** 12 — Stream live Session Timeline entries; 14 — Negotiate runtime controls

**Status:** resolved

- [ ] Notifications, status, widgets, title, and editor-text injection use typed capability-negotiated worker messages distinct from response-bearing Interactions.
- [ ] Status, widget, and title projections are scoped to the exact Session worker generation and disappear when cleared, replaced, or invalidated by worker loss.
- [ ] A Pi title update changes presentation only and never renames the Session.
- [ ] Request payloads are bounded, schema-validated, and rendered as inert content rather than executable markup.
- [ ] Editor-text injection targets only the invoking Client's matching View and observed Composer Draft revision.
- [ ] If the target View is gone or draft revision changed, Pidex preserves the text as an explicit non-destructive suggestion rather than overwriting, broadcasting, or rerouting it.
- [ ] Tests cover effect replacement/clear, worker generation loss, multiple Clients, stale draft revision, unsupported capabilities, and malicious markup.
