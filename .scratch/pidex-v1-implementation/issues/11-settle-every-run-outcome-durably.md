# 11 — Settle every Run outcome durably

**What to build:** Give every accepted Run exactly one durable terminal outcome by coordinating Pi artifact checkpoints, immutable Timeline payloads, SQLite settlement, and evidence-based abnormal resolution without replaying uncertain execution.

**Blocked by:** 10 — Execute the first completed Run

**Status:** ready-for-agent

- [ ] The worker durably flushes the Pi artifact and returns stable checkpoint evidence before normal settlement can commit.
- [ ] Immutable Timeline payloads stage, flush, verify, and publish before SQLite may reference them.
- [ ] One SQLite transaction verifies the expected executing Run/checkpoint, records normalized Timeline facts and blob references, assigns one terminal outcome, and advances revisions/cursor.
- [ ] Completed means normal Pi settlement; Failed means unrecovered model/runtime settlement; Cancelled means accepted Host/user cancellation; Interrupted means normal completion cannot be proved.
- [ ] Tool errors handled inside the conversation do not by themselves make the Run Failed.
- [ ] Crashes between checkpoint, blob publication, and SQLite commit reconcile only from durable proof and never replay the Run to discover what happened.
- [ ] Every accepted Run remains visible and receives exactly one terminal outcome across worker, daemon, and test-controlled Host loss at every settlement boundary.
