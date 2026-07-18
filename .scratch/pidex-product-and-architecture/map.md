## Destination

Produce an implementation-ready product and architecture specification for Pidex: a Windows-first, PWA-first, local-LAN interface that gives one developer a robust, full-featured multi-session Pi experience, with clear seams for later workspace tooling.

## Notes

- Domain: local-first coding-agent control planes, Pi session supervision, reconnectable PWAs, and authenticated LAN access.
- Every session should consult the `grilling` and `domain-modeling` skills when resolving product or architecture decisions.
- Existing research compared Tau, pi-web-ui, Piface, Pi Dashboard, PI WEB, Paseo, Pi Remote Control, Remote Pi, messenger bridges, Pi RPC/SDK documentation, and Codex App Server.
- Existing implementation reference: [Pi Tin](https://github.com/samanthar0se/pi-tin) contains prior chat rendering, turn-model, tool-card, composer, and Codex-fidelity work to draw from; treat it as chat UX and implementation evidence, not authority for Pidex Session lifecycle, transport, security, or ownership semantics.
- Standing preferences: PWA first; Electron later; Windows host first; single developer across multiple devices; core session experience first; preserve extensibility seams for workspace tooling.
- Planning only: tickets resolve decisions and culminate in a specification; they do not implement Pidex.

## Decisions so far

- [Define the core product promise](issues/01-define-core-product-promise.md) — V1 makes an authenticated LAN PWA the complete daily-driver interface for host-owned Pi sessions on one Windows host, with shared multi-device control, reconnectable execution, runtime-capability parity, no artificial session cap, and workspace tooling deferred.
- [Establish the ubiquitous language](issues/02-establish-ubiquitous-language.md) — Host-local Projects optionally contain concrete Workspaces; durable Sessions contain individual Runs and may fork independently; paired Devices create ephemeral Clients and local Views; retention and runtime residency use separate available/archived and resident/sleeping axes.
- [Choose the Pi runtime boundary](issues/03-choose-pi-runtime-boundary.md) — Each resident Session gets an immutably bound, Pidex-pinned Pi SDK worker behind a fail-closed, capability-negotiated Pidex protocol; isolation contains reliability failures without claiming a security sandbox or blindly replaying uncertain mutations.
- [Define session lifecycle and recovery](issues/04-define-session-lifecycle-and-recovery.md) — Daemon-accepted Runs execute one at a time to durable Pi settlement with explicit outcomes, targeted cancellation, demand-driven residency, quiescent archival, stable-point Forks, and evidence-based no-replay recovery that holds safe queued work after abnormal outcomes.
- [Design client-daemon consistency](issues/05-design-client-daemon-consistency.md) — Host-authoritative layered snapshots and a resumable typed change stream synchronize scoped Client projections; revision-preconditioned commands use durable receipts, and reconnects resume or reset without replaying intent or merging authority.
- [Set the LAN trust boundary](issues/06-set-lan-trust-boundary.md) — V1 intends Windows Private-LAN exposure through warning-only firewall enforcement, trusts the entire Host, and requires one private-CA HTTPS origin, equal key-authenticated Devices, no anonymous product data, immediate targeted revocation, and no Pi project-resource trust gate.
- [Design the PWA information architecture](issues/07-design-pwa-information-architecture.md) — V1 closely clones Codex’s quiet two-pane shell: recent Project/Workspace-grouped Sessions select one routable lifecycle-independent View, mobile uses the same sidebar as a drawer, and open Interactions pin above the still-available composer.
- [Choose persistence and ownership](issues/08-choose-persistence-and-ownership.md) — SQLite owns transactional Pidex state, pinned workers own versioned Pi artifacts, immutable blobs hold large payloads, Devices hold only credentials and local UI state, and managed backup, migration, retention, and fail-closed recovery preserve those authority boundaries.
- [Define Windows daemon operations](issues/09-define-windows-daemon-operations.md) — A per-user launcher supervises versioned portable daemons, signed quiescent updates, DPAPI-backed private PKI, minimal Private-only mDNS, local diagnostics, and strictly Job-contained workers, while wildcard HTTPS accepts warning-only firewall drift.
- [Preserve workspace and extension seams](issues/10-preserve-workspace-extension-seams.md) — A small authority kernel hosts typed, isolation-ready modules with opaque IDs, registered protocol and storage families, semantic UI contributions, explicit Host-owned process lifecycles, and edge adapters without making Sessions own workspace tooling.
- [Define the human interaction and approval model](issues/13-define-human-interaction-and-approval-model.md) — Host-owned generic Pi Interactions use an open/resolving/four-cause terminal state machine, first-valid multi-Device responses, extension-only deadlines, exact-worker acknowledgement, no uncertain replay, and redacted free-form answers.
- [Define offline cache and background behavior](issues/14-define-offline-cache-and-background-behavior.md) — Devices keep a bounded, explicitly stale read-only working set; commands wait for atomic reconciliation, service workers stay non-authoritative, optional rich Web Push is advisory, and revocation cleanup is best effort rather than remote wipe.
- [Define backup and data recovery operations](issues/15-define-backup-and-data-recovery-operations.md) — Daily local recovery, manually encrypted portable export, tiered verification, conservative pressure cleanup, explicit whole-Host restore, and emergency Reidentify preserve authority without silent replay, rollback, or salvage.
- [Set the quality and acceptance bar](issues/11-set-quality-and-acceptance-bar.md) — Hard traced gates cover the declared browser and capacity matrix, responsive latency and resource bounds, deterministic Pi contracts, automated security, comprehensive fault recovery, soak and daily-driver evidence, while accessibility and rich observability remain non-blocking.
- [Synthesize the implementation-ready specification](issues/12-synthesize-implementation-ready-spec.md) — The resolved product and architecture decisions form one contradiction-free implementation handoff, with no further decision required before planning and only constrained implementation parameters left to select.

## Not yet specified

None.

## Out of scope

- Building the application during this map.
- Native mobile applications.
- Electron desktop packaging in the first release; only compatibility seams for a later wrapper are in scope.
- Fully specifying or loading a third-party Pidex-native extension framework; v1 preserves only protocol and contribution seams for a later effort.
- Public-internet relay infrastructure; a later tunneling solution may reuse the LAN protocol.
- Multi-user roles, teams, and tenant isolation.
- Full specification of Git review, worktrees, file editing, terminals, and other workspace tooling beyond the seams required to add them later.
