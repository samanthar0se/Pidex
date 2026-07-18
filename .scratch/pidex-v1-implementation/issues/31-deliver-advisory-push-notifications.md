# 31 — Deliver advisory Push notifications

**What to build:** Notify a Device about eligible Host facts when browser/platform support permits, while making delivery advisory, privacy-configurable, deduplicated, and incapable of issuing commands or claiming current state.

**Blocked by:** 19 — Resolve Interaction races, deadlines, and redaction; 26 — Recover from daemon or Host loss; 30 — Preserve drafts and update the service worker safely

**Status:** ready-for-agent

- [ ] Each Device can explicitly enable/disable Web Push and configure notification categories without changing Host authority.
- [ ] Default eligible events are newly open Interactions, every Run terminal outcome, held work after Failed/Interrupted predecessors, and Pi warning/error notifications.
- [ ] Routine output, keyed status/widgets, title, successful synchronization, and ordinary informational activity remain in-app by default.
- [ ] Payloads are encrypted, bounded, versioned hints with stable event/Host identity, event time, and preview data; they never contain input/editor Interaction Responses.
- [ ] Rich previews are the disclosed default and each Device offers generic-text privacy before/after permission grant.
- [ ] Duplicate, delayed, superseded, or already-terminal hints are harmless and deduplicate against Host event identity.
- [ ] Clicking a notification opens the canonical target View, authenticates, and reconciles before current status/control; buttons never issue commands.
- [ ] Tests cover unsupported platforms, permission denial, internet/push outage, deadline miss, duplicate/delayed delivery, lock-screen privacy, and foreground/in-app deduplication.
