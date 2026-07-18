# 33 — Retain and garbage-collect durable stores safely

**What to build:** Preserve every authoritative Host fact for its decided lifetime and reclaim only disposable or provably unreachable storage without breaking Sessions, Fork ancestry, retries, reconnect, or security history.

**Blocked by:** 19 — Resolve Interaction races, deadlines, and redaction; 24 — Fork stable Session history; 26 — Recover from daemon or Host loss

**Status:** ready-for-agent

- [ ] SQLite is the sole authority for Host identity metadata, Projects, Workspaces, Sessions, Runs, Timeline, Interactions, revisions, cursors, receipts, Devices, manifests, and maintenance facts.
- [ ] Pi artifacts remain authoritative only for pinned-runtime resume/fork state, and immutable blob bytes remain subordinate to SQLite meaning and references.
- [ ] Available/Archived Session identity, complete reachable Timeline, blobs, required Pi artifacts, ancestry, Device records, and revocation tombstones retain indefinitely in v1.
- [ ] Command receipt proof remains available at least 30 days and synchronization changes at least seven days; compaction yields expired/indeterminate or reset semantics rather than revived intent/data loss.
- [ ] New files stage, flush, verify, and atomically publish before SQLite references; failed transactions can leave only unreachable bytes.
- [ ] Garbage collection proves unreachability from every Session, Fork, active artifact generation, protected migration/rollback, and retained recovery manifest.
- [ ] Orphan handling quarantines/tombstones after one stable proof and deletes only after a later independent proof; uncertainty retains/restores bytes.
- [ ] Tests cover reference races, failed publication transaction, receipt/change-log compaction, ancestry retention, interrupted cleanup, reparse-point escape, and restart.
