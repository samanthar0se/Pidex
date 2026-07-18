# 24 — Fork stable Session history

**What to build:** Let the developer create an independent child Session from any Pi-validated durable stable point, preserving ancestry and history while inheriting no live runtime work.

**Blocked by:** 13 — Reach complete paginated Session history; 23 — Archive and restore Sessions safely

**Status:** ready-for-agent

- [ ] Eligible Fork points are durable Timeline/Pi history entries validated by the matching pinned runtime; streaming or partial entries are rejected.
- [ ] Fork commits a new available/sleeping Session with immutable parent identity, fork-point identity, and inherited history through that point.
- [ ] The new Session inherits Project/Workspace scope by default and permits an explicit valid scope override at creation.
- [ ] Fork inherits no worker, queued/executing Run, steering, Interaction, cancellation, retry, or other transient state.
- [ ] Forking from an earlier stable point neither stops nor mutates an executing parent and does not require restoring an archived parent.
- [ ] Ancestry and reference closure survive daemon restart, archive/restore, later parent activity, and complete-history pagination.
- [ ] Tests cover archived/executing parents, invalid/partial points, scope validation, artifact creation/migration boundary, and independent child execution.
