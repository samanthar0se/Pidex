## Destination

Produce an implementation-ready product and architecture specification for Pidex: a Windows-first, PWA-first, local-LAN interface that gives one developer a robust, full-featured multi-session Pi experience, with clear seams for later workspace tooling.

## Notes

- Domain: local-first coding-agent control planes, Pi session supervision, reconnectable PWAs, and authenticated LAN access.
- Every session should consult the `grilling` and `domain-modeling` skills when resolving product or architecture decisions.
- Existing research compared Tau, pi-web-ui, Piface, Pi Dashboard, PI WEB, Paseo, Pi Remote Control, Remote Pi, messenger bridges, Pi RPC/SDK documentation, and Codex App Server.
- Standing preferences: PWA first; Electron later; Windows host first; single developer across multiple devices; core session experience first; preserve extensibility seams for workspace tooling.
- Planning only: tickets resolve decisions and culminate in a specification; they do not implement Pidex.

## Decisions so far

- [Define the core product promise](issues/01-define-core-product-promise.md) — V1 makes an authenticated LAN PWA the complete daily-driver interface for host-owned Pi sessions on one Windows host, with shared multi-device control, reconnectable execution, runtime-capability parity, no artificial session cap, and workspace tooling deferred.
- [Establish the ubiquitous language](issues/02-establish-ubiquitous-language.md) — Host-local Projects optionally contain concrete Workspaces; durable Sessions contain individual Runs and may fork independently; paired Devices create ephemeral Clients and local Views; retention and runtime residency use separate available/archived and resident/sleeping axes.
- [Choose the Pi runtime boundary](issues/03-choose-pi-runtime-boundary.md) — Each resident Session gets an immutably bound, Pidex-pinned Pi SDK worker behind a fail-closed, capability-negotiated Pidex protocol; isolation contains reliability failures without claiming a security sandbox or blindly replaying uncertain mutations.
- [Define session lifecycle and recovery](issues/04-define-session-lifecycle-and-recovery.md) — Daemon-accepted Runs execute one at a time to durable Pi settlement with explicit outcomes, targeted cancellation, demand-driven residency, quiescent archival, stable-point Forks, and evidence-based no-replay recovery that holds safe queued work after abnormal outcomes.

## Not yet specified

- Offline and background-mobile behavior may need sharper decisions after the client/daemon consistency model is settled.
- The boundary between core session capabilities and later file, Git, worktree, terminal, and background-process modules may split into additional tickets after the domain model is resolved.
- Packaging, upgrade, migration, diagnostics, and recovery details may need separate tickets once daemon ownership and persistence boundaries are known.
- The final specification structure and handoff format will be determined after the major decisions are closed.

## Out of scope

- Building the application during this map.
- Native mobile applications.
- Electron desktop packaging in the first release; only compatibility seams for a later wrapper are in scope.
- Fully specifying or loading a third-party Pidex-native extension framework; v1 preserves only protocol and contribution seams for a later effort.
- Public-internet relay infrastructure; a later tunneling solution may reuse the LAN protocol.
- Multi-user roles, teams, and tenant isolation.
- Full specification of Git review, worktrees, file editing, terminals, and other workspace tooling beyond the seams required to add them later.
