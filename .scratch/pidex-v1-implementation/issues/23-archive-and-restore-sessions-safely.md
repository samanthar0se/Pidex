# 23 — Archive and restore Sessions safely

**What to build:** Let the developer reversibly remove a quiescent Session from normal discovery and later restore it without deleting history, ancestry, identity, or accidentally controlling execution.

**Blocked by:** 22 — Sleep and wake Sessions at quiescence

**Status:** resolved

- [ ] Plain Archive accepts only a quiescent Session and never silently cancels, drains, or waits for work.
- [ ] The PWA may offer an explicit Stop-then-Archive flow, but Stop and Archive remain separate commands with separate receipts/outcomes.
- [ ] Successful Archive makes the Session archived and sleeping, removes it from normal discovery, and rejects new Runs.
- [ ] Archived Sessions remain readable, exportable, retained indefinitely, and valid Fork parents.
- [ ] Restore makes the Session available and sleeping and does not wake Pi until later accepted work requires it.
- [ ] Archived discovery is a distinct main-pane destination with restore actions, while ordinary View navigation remains lifecycle-neutral.
- [ ] Multi-Client tests cover archive/quiescence races, stale archive/restore, archived Run rejection, restart, and complete history preservation.
