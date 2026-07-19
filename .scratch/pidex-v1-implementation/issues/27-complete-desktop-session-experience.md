# 27 — Complete the desktop Session experience

**What to build:** Deliver the approved quiet desktop PWA shell as the complete daily-driver surface for discovery, Session navigation, Timeline work, runtime controls, queues, Interactions, lifecycle, recovery cues, and Forks.

**Blocked by:** 19 — Resolve Interaction races, deadlines, and redaction; 23 — Archive and restore Sessions safely; 24 — Fork stable Session history; 26 — Recover from daemon or Host loss

**Status:** resolved

- [ ] The persistent sidebar provides New Session, Archived, Project/Workspace-grouped available Sessions, search/filtering, and fixed Host/Device/settings status.
- [ ] Sessions remain ordered by recent authoritative activity within groups rather than moving into state-priority sections.
- [ ] Compact cues/subtitles distinguish executing Runs, open Interactions, queued/held work, sleeping residency, and abnormal outcomes without “active/idle Session” language.
- [ ] The main pane exposes stable routes, Session identity/scope, capability controls, exact-target Run actions, complete Timeline, Interaction pager, and composer.
- [ ] New Session remains local until explicit empty creation or first submit; backing out creates no Host object.
- [ ] Unsupported controls are omitted/disabled, pending commands are non-authoritative, and stale/offline/current Host state remains visible.
- [ ] V1 adds no internal Session tabs, split view, Host-wide Attention destination, or supervision dashboard.
- [ ] Browser end-to-end tests cover keyboard/mouse flows, browser back/forward, multiple tabs, race reconciliation, archived discovery, Fork, and all core Session actions.
