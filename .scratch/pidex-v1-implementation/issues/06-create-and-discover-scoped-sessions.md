# 06 — Create and discover scoped Sessions

**What to build:** Let a paired Client create an intentionally empty available/sleeping Session with valid optional Project and Workspace scope, then discover it through the initial Host command, snapshot, Change Set, and sidebar projection path.

**Blocked by:** 05 — Authenticate and revoke Devices

**Status:** resolved

- [ ] A Client can open a local New Session View, select valid scope, and leave without creating Host state.
- [ ] An explicit empty-Session action durably creates Session identity, immutable optional scope, available retention, sleeping residency, metadata revision, and Timeline basis before any Pi artifact exists.
- [ ] Workspace-targeted Sessions are constrained to that Workspace's Project; invalid or cross-scope references are rejected before commit.
- [ ] Host, Project, Workspace, and Session summaries arrive through an atomic snapshot followed by typed Change Sets, not generic JSON Patch or direct command-response mutation.
- [ ] The PWA groups available Sessions by Project and Workspace, including Project-scoped and Host-unscoped groups, and selecting one creates only a routable Client View.
- [ ] Reloading or closing the View does not wake, archive, or otherwise mutate the Session.
- [ ] Product tests prove rejection creates no Session, committed creation survives daemon restart, and an empty Session requires no worker or Pi artifact.
