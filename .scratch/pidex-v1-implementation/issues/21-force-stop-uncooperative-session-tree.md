# 21 — Force-stop an uncooperative Session tree

**What to build:** Enforce accepted Stop when Pi, a tool, or an extension refuses to settle by terminating only the affected Session's contained process tree and reconciling the result as Cancelled.

**Blocked by:** 20 — Stop a Run cooperatively

**Status:** ready-for-agent

- [ ] Every Session worker starts suspended, joins its own non-breakaway kill-on-close Windows Job, and resumes only after containment succeeds.
- [ ] Worker descendants, shells, tools, extensions, grandchildren, and attempted detached processes remain inside the Session Job.
- [ ] Accepted Stop waits 10 seconds for cooperative settlement, then closes/terminates only the affected Session Job and allows five seconds for authoritative reconciliation.
- [ ] Forced enforcement of accepted user intent produces Cancelled rather than Interrupted and preserves recoverable partial Timeline plus side-effect warnings.
- [ ] Losing or closing one Session Job does not terminate the daemon, sibling workers, or their descendants.
- [ ] A containment setup failure blocks worker execution with a typed diagnostic rather than running an escapable process tree.
- [ ] Windows contract and product tests use uncooperative descendants, nested grandchildren, detach attempts, IPC loss, and sibling Session work to prove containment.
