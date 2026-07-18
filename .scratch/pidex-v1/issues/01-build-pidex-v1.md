Type: spec
Status: open
Labels: ready-for-agent
Blocked by:

# Build Pidex v1

## Problem Statement

A developer who uses Pi from several desktop and mobile Devices cannot rely on a browser as their complete daily-driver interface today. A browser View may disappear, disconnect, sleep, or reload while Pi work must continue safely on the Windows Host. Multiple Clients can race, networks can fail after a command is sent, Pi and its tools can crash or hang, and a Host can restart while accepted work is unsettled. Without one durable Host authority, these conditions can lose work, duplicate intent, present stale state as current, or make recovery depend on private Pi formats.

The developer also needs this access to be practical on a local LAN without turning Pidex into a public multi-user service. Pairing, Device authentication, HTTPS, Windows startup, worker containment, updates, diagnostics, backups, and recovery all have to work as one product. The resulting system must preserve clean seams for later workspace tooling without making Sessions own files, Git, terminals, or long-lived processes.

## Solution

Build Pidex v1 as a Windows-first Host with an authenticated, installable PWA for desktop and mobile. The Host owns Projects, Workspaces, Sessions, Runs, Interactions, Session Timelines, Devices, commands, synchronization, persistence, and recovery. Each resident Session receives an isolated worker running the exact bundled Pi SDK behind a versioned Pidex protocol. Clients consume Host snapshots and Change Sets, issue exact-target revision-preconditioned commands, and reconcile rather than becoming authorities themselves.

The product provides the complete core Pi Session workflow: create, discover, open, rename, archive, restore, resume, fork, read complete history, stream live output, choose negotiated runtime options, submit prompts, steer, queue follow-ups, answer Interactions, and Stop exact executing Runs. Sessions continue without Clients and recover conservatively after loss without uncertain replay.

Pidex installs per user, starts at Windows logon, exposes one private-CA HTTPS origin on the LAN, pairs equal-authority Devices with non-extractable signing keys, and uses Windows Firewall as warning-only intended Private-profile enforcement. SQLite owns transactional product state, immutable stores own large payloads and Pi artifacts, and managed snapshots, encrypted portable backups, whole-Host restore, and Reidentify provide recovery. A small authority kernel and typed feature-module contracts preserve later workspace, process, Electron, tunnel, and native-extension seams.

## User Stories

1. As a developer, I want to install Pidex for my Windows user without installing a separate system Node runtime, so that setup is self-contained.
2. As a developer, I want Pidex to start automatically after I sign in to Windows, so that my Host is normally available without manual startup.
3. As a developer, I want Pidex to run unelevated for normal work, so that it uses my ordinary Pi configuration and credentials without a permanently privileged service.
4. As a developer, I want elevation to occur only for narrowly scoped firewall changes, so that Pidex cannot turn a privileged helper into arbitrary command execution.
5. As a developer, I want one stable canonical HTTPS origin for my Host, so that installed PWAs, Device keys, service workers, and caches remain usable across restarts and updates.
6. As a developer, I want deterministic QR, hostname, and manual discovery fallbacks, so that I can reach the Host when mDNS is unavailable.
7. As a developer, I want Pidex to detect a canonical-name collision before committing the origin, so that it does not silently rename an established Host later.
8. As a developer, I want temporary CA onboarding to expose no product data or credentials over HTTP, so that insecure bootstrap does not become an authenticated fallback.
9. As a developer, I want to pair a Device with a short-lived one-time secret, so that LAN discovery alone grants no authority.
10. As a developer, I want pairing to explain that a Device receives full Pidex and Host-user authority, so that I understand the trust I am granting.
11. As a developer, I want each browser profile or app installation to have its own Device identity, so that I can revoke one without disturbing the others.
12. As a developer, I want Device authentication to use non-extractable signing keys and short-lived challenge sessions, so that Pidex stores no replayable long-lived bearer token.
13. As a developer, I want paired Devices to remain paired until explicit revocation, so that routine inactivity does not force re-pairing.
14. As a developer, I want any paired Device or the Host-local administration surface to revoke another Device immediately, so that future access stops promptly.
15. As a developer, I want revocation messaging to distinguish access removal from remote erasure, so that I do not mistake best-effort cache cleanup for a wipe guarantee.
16. As a developer, I want to create a Session with an initial prompt, so that I can start ordinary work in one flow.
17. As a developer, I want to create an intentionally empty Session, so that I can establish scope before sending work.
18. As a developer, I want an empty Session to survive initial worker or Run failure, so that Session identity is not coupled to successful execution.
19. As a developer, I want to group Sessions under Projects and optional Workspaces, so that discovery reflects the code and working copies I use.
20. As a developer, I want Host-unscoped and Project-scoped Sessions represented without inventing fake Workspaces, so that grouping remains truthful.
21. As a developer, I want recent Sessions ordered by authoritative activity within their Project and Workspace groups, so that likely work is easy to find.
22. As a developer, I want search and lightweight filtering across many retained Sessions, so that discovery remains usable at scale.
23. As a developer, I want compact Session-row cues for executing Runs, Interactions, held work, sleeping residency, and abnormal outcomes, so that I can supervise several Sessions without a dashboard.
24. As a developer, I want one routable Session View per browser surface, so that browser back, forward, tabs, and windows provide familiar navigation.
25. As a developer, I want opening or closing a View to leave Session execution, retention, and residency unchanged, so that navigation never controls Host work accidentally.
26. As a developer, I want to rename a Session with conflict-aware reconciliation, so that concurrent Clients do not silently overwrite one another.
27. As a developer, I want to archive only a quiescent Session, so that archive never silently stops or drains work.
28. As a developer, I want an explicit Stop-then-Archive path when work is in progress, so that cancellation remains a visible separate decision.
29. As a developer, I want to restore an archived Session as available and sleeping, so that reading retention state does not wake Pi.
30. As a developer, I want archived Sessions to remain readable, exportable, and valid Fork parents, so that archival is reversible rather than deletion.
31. As a developer, I want Sessions to wake only when an accepted action requires Pi, so that reading history does not consume worker resources.
32. As a developer, I want Sessions to sleep only at a verified quiescent boundary, so that runtime disposal cannot abandon accepted work or Interactions.
33. As a developer, I want an accepted prompt to become a durable Run before worker dispatch, so that acknowledged work survives worker or Host loss.
34. As a developer, I want every accepted Run to have exactly one visible terminal outcome, so that work never disappears into an ambiguous state.
35. As a developer, I want Completed, Failed, Cancelled, and Interrupted to remain distinct outcomes, so that normal failure, accepted Stop, and unproved recovery are not conflated.
36. As a developer, I want a Session to execute at most one Run at a time, so that conversation ordering is deterministic.
37. As a developer, I want follow-up prompts to become separate durable queued Runs, so that Pi's transient in-memory queue is not authoritative.
38. As a developer, I want steering to target the exact executing Run, so that late network delivery cannot mutate a successor.
39. As a developer, I want stale steering rejected rather than converted into a follow-up, so that Pidex never changes my intent silently.
40. As a developer, I want queued follow-ups to start automatically only after a predecessor completes, so that normal Session flow is convenient and ordered.
41. As a developer, I want follow-ups held after a failed or interrupted predecessor, so that they do not run automatically against possibly partial context.
42. As a developer, I want to release or cancel held follow-ups explicitly, so that recovery preserves my control.
43. As a developer, I want Stop to target the exact executing Run I observed, so that network latency cannot stop a successor.
44. As a developer, I want Stop to cancel undelivered steering and queued follow-ups in that Session, so that cancellation leaves no hidden continuation.
45. As a developer, I want cooperative cancellation before forced worker termination, so that Pi and tools can settle normally when possible.
46. As a developer, I want uncooperative cancellation contained to one Session worker tree, so that sibling Sessions continue safely.
47. As a developer, I want partial output and already-committed side effects to remain visible after cancellation or interruption, so that Pidex does not pretend to roll back external effects.
48. As a developer, I want to Fork from any Pi-validated stable history point, so that I can explore an alternative without mutating the parent Session.
49. As a developer, I want a Fork to preserve immutable ancestry and inherited history, so that its origin is clear.
50. As a developer, I want to override inherited Project or Workspace scope while creating a Fork, so that the new Session can continue in another valid context.
51. As a developer, I want a Fork to inherit no active worker, queue, steering, Interaction, or cancellation state, so that it starts independently.
52. As a developer, I want the full Session Timeline to combine prompts, output, tools, Interactions, Run outcomes, and recovery notices, so that the product history is complete without exposing Pi's private format.
53. As a developer, I want live Timeline entries to update in place until finalized, so that streaming output is efficient and stable.
54. As a developer, I want finalized Timeline entries to remain immutable with later corrections appended, so that history does not change silently.
55. As a developer, I want old Timeline pages available through stable pagination, so that complete history remains reachable without unbounded reconnect snapshots.
56. As a developer, I want capability-dependent model and mode controls, so that the PWA exposes what the pinned Pi runtime actually supports.
57. As a developer, I want missing required Pi capabilities to fail readiness clearly, so that Pidex never degrades below its daily-driver promise silently.
58. As a developer, I want Pi select, confirm, input, and editor requests represented as generic Interactions, so that Pidex does not invent approval semantics from text.
59. As a developer, I want open Interaction controls pinned above the still-available composer, so that answering does not block steering or follow-up composition.
60. As a developer, I want to navigate several open Interactions in one Session, so that independent extension requests remain usable.
61. As a developer, I want extension-declared Interaction deadlines to remain Host-authoritative across reconnects and Devices, so that local timers cannot change outcomes.
62. As a developer, I want the first valid Device response to win and later responses to reconcile as stale, so that multi-Device races have one authoritative result.
63. As a developer, I want an accepted Interaction Response delivered only to the exact worker request, so that uncertain values are never replayed into another prompt.
64. As a developer, I want input and editor response plaintext removed from Pidex history, receipts, logs, and caches after delivery, so that free-form sensitive answers are not retained unnecessarily.
65. As a developer, I want Dismiss to affect one Interaction without implying Run Stop, so that extensions can decide how to continue.
66. As a developer, I want desktop Pidex to use a quiet sidebar-and-conversation shell, so that core Session work remains the focus.
67. As a developer, I want mobile Pidex to preserve the same hierarchy in a drawer, so that I do not have to learn a different navigation model.
68. As a mobile developer, I want exact-target Stop directly reachable while a Run executes, so that urgent control is not buried in overflow.
69. As a developer, I want unsupported controls omitted or disabled rather than simulated, so that the UI remains honest about negotiated capabilities.
70. As a developer, I want each Client to receive Host snapshots and typed Change Sets, so that authoritative projection changes have one consistent path.
71. As a developer, I want command results to remain separate from authoritative projection updates, so that response ordering cannot corrupt Client state.
72. As a developer, I want commands to carry exact targets, capabilities, revisions, and state preconditions, so that races reject stale intent rather than merging it.
73. As a developer, I want identical command retries to return durable recorded outcomes, so that uncertain transport does not duplicate accepted work.
74. As a developer, I want expired or indeterminate old Command IDs rejected rather than re-executed, so that receipt compaction cannot recreate intent.
75. As a developer, I want reconnect to resume from an opaque Host cursor when possible, so that brief disconnects recover efficiently.
76. As a developer, I want explicit scope reset when a cursor, epoch, protocol, or revision is incompatible, so that cached and Host authority are never merged.
77. As a developer, I want slow Clients disconnected for resynchronization, so that they cannot backpressure Session workers or other Clients.
78. As a developer, I want a Client that says `current` to match the Host projection for all synchronized scopes, so that currentness has a testable meaning.
79. As a developer, I want cached Session data readable offline with prominent stale state and synchronization time, so that I can reference prior work without mistaking it for current status.
80. As a developer, I want all Host mutations disabled until required scopes are current, so that stale Clients cannot control Host work.
81. As a developer, I want Composer Drafts editable and optionally durable while offline, so that local writing survives without becoming queued intent.
82. As a developer, I want reconnect never to auto-send a draft or offline action, so that returning online cannot surprise me.
83. As a developer, I want uncertain commands sent while current to reconcile by their original identity, so that transport recovery differs from offline queuing.
84. As a developer, I want the service worker limited to shell caching, offline fallback, Push, and notification routing, so that browser background lifecycle never owns authority.
85. As a developer, I want Pidex to assume stale state after browser suspension, so that background throttling cannot produce false currentness.
86. As a developer, I want optional Web Push for new Interactions, Run outcomes, held work, and Pi warnings/errors, so that important Host events can reach me away from an open Client.
87. As a developer, I want Push described as advisory and best effort, so that I do not rely on it for deadlines or correctness.
88. As a developer, I want a generic notification privacy mode in addition to disclosed rich previews, so that I can limit lock-screen exposure per Device.
89. As a developer, I want notification clicks to open and reconcile the canonical PWA without issuing commands, so that delayed notifications cannot mutate Host state.
90. As a developer, I want a configurable bounded offline cache with visible storage usage, so that Pidex does not grow Device storage without control.
91. As a developer, I want cache eviction to preserve pairing and explicitly retained drafts, so that replaceable content cleanup does not remove authority or writing unexpectedly.
92. As a developer, I want SQLite to own every transactional Pidex fact, so that command acceptance, ordering, revisions, and recovery have one authority.
93. As a developer, I want Pi artifacts read and migrated only by matching pinned workers, so that the daemon never depends on private Pi formats.
94. As a developer, I want large immutable payloads published before database references, so that committed records never point at partial files.
95. As a developer, I want Run completion reported only after Pi checkpoint, payload publication, and SQLite settlement commit, so that visible outcomes are durable.
96. As a developer, I want authoritative Session and security history retained indefinitely in v1, so that archival and maintenance do not become silent deletion.
97. As a developer, I want at least 30 days of command receipt proof and seven days of resumable changes, so that retries and reconnects have explicit durability windows.
98. As a developer, I want updates to stage signed complete releases and activate only at Host-wide quiescence, so that daemon, worker, and data versions never mix.
99. As a developer, I want failed pre-acceptance updates to roll back safely, so that a bad release does not strand the Host.
100. As a developer, I want repeated startup failure to open a visible circuit breaker, so that crash loops stop while local diagnosis remains available.
101. As a developer, I want `pidex doctor` and local diagnostics to inspect identity, certificates, database, firewall, mDNS, updates, workers, and storage, so that failures are actionable.
102. As a developer, I want logs and support bundles redacted by default and no automatic telemetry, so that coding content stays local unless I export it explicitly.
103. As a developer, I want normal stop, restart, update, uninstall, and backup to drain then abort safely rather than escalate silently, so that accepted work remains under my control.
104. As a developer, I want Windows shutdown to flush briefly and then reconcile unproved work as Interrupted, so that system shutdown cannot block indefinitely or mislabel outcomes.
105. As a developer, I want normal uninstall to preserve durable Host data and identity, so that reinstall can recover my Host.
106. As a developer, I want changed-day local recovery snapshots created automatically and before risky migrations, so that ordinary application damage has recent restore points.
107. As a developer, I want seven rolling changed-day recovery points plus protected manual and rollback points, so that rotation remains predictable and conservative.
108. As a developer, I want portable backups to be manual, passphrase-encrypted, complete, and fully verified, so that I can recover after disk or Host loss without storing a reusable passphrase.
109. As a developer, I want backup presentation to distinguish bundle, transfer, and destination verification, so that browser download does not overclaim saved-file integrity.
110. As a developer, I want background integrity scrubbing and exact-byte repair from independently verified copies, so that silent corruption is detected without approximate reconstruction.
111. As a developer, I want two-pass orphan quarantine before deletion, so that uncertain reachability retains data.
112. As a developer, I want storage-protection mode to reject discretionary growth before emergency headroom is consumed, so that accepted work, Stop, revocation, and diagnosis can still settle.
113. As a developer, I want a Recovery page for snapshots, backups, integrity, operations, and storage pressure, so that recovery state is understandable during normal operation.
114. As a developer, I want global authority corruption to disable LAN service and require Host-local recovery, so that uncertain authorization is never exposed remotely.
115. As a developer, I want restore to verify and replace the whole Host explicitly rather than merge or salvage records, so that authority remains coherent.
116. As a developer, I want restore preview to disclose rollback range, affected work, Device state, origin, and revocation rollback risk, so that I can make an informed irreversible choice.
117. As a developer, I want restored executing work to become Interrupted and queued work held, so that restore never silently replays captured intent.
118. As a developer, I want Reidentify when verified product data survives but trust keys do not, so that I can preserve data while explicitly ending old cryptographic continuity.
119. As a developer, I want future workspace tooling to own resources beside Sessions, so that Session lifecycle never implicitly owns files, Git, terminals, or long-lived processes.
120. As a developer, I want typed module, protocol, storage, lifecycle, and UI contribution seams, so that later features can be added without bypassing Host authority.
121. As a developer, I want missing or incompatible modules to isolate only their resource kinds while preserving data, so that unrelated Session and recovery functions remain available.
122. As a developer, I want a future Electron shell or tunnel to use the same Device, authentication, command, and synchronization contracts, so that edge packaging does not create a second authority.
123. As a developer, I want required browsers, capacity tiers, latency, resource, security, fault, soak, and daily-driver gates to block release, so that the daily-driver promise is evidence-based.
124. As a developer, I want accepted work tested against loss, duplication, reordering, corruption, disk pressure, process failure, and recovery boundaries, so that safety claims survive realistic faults.
125. As a developer, I want every shipped artifact signed with a matching SBOM and no known high or critical vulnerability, so that release provenance and dependency risk are controlled.
126. As a developer, I want unsupported browsers to fail clearly rather than present partial-current control, so that compatibility failure is safe.
127. As a developer, I want performance tested with 10,000 retained Sessions, a 100,000-entry Timeline, and several simultaneous Clients, so that scale assumptions are proven.
128. As a developer, I want a seven-day real daily-driver trial from desktop and mobile before release, so that Pidex proves it can replace another Pi UI for core Session work.

## Implementation Decisions

### Product and domain

- V1 supports one developer, one Windows Host, multiple paired Devices, multiple simultaneous Clients, and no artificial retained-Session cap.
- The canonical domain language is Host, Project, Workspace, Session, Run, Interaction, Interaction Response, Session Timeline, Device, Client, View, Composer Draft, Fork, and Reidentify.
- Session retention (`available`/`archived`), runtime residency (`resident`/`sleeping`), Client View lifecycle, and Run lifecycle are independent axes.
- A Workspace belongs to one Project. A Session has immutable optional Project and Workspace scope. A Workspace-targeted Session belongs to that Workspace's Project.
- Durable identifiers are immutable, opaque, type-qualified, and Host-local. Paths, names, ports, URLs, process IDs, and provider handles are locators or attributes.
- V1 provides no destructive Session deletion and no Host-wide Attention dashboard, internal Session tabs, split view, role model, or multi-user tenancy.

### Host architecture

- Build a stable per-user Host launcher, one authoritative daemon/kernel, isolated per-resident-Session Node workers, SQLite and immutable stores, HTTPS/WebSocket edge, PWA and service worker, Windows platform adapter, privileged firewall helper, signed control CLI, and localhost setup/recovery surface.
- The authority kernel owns authentication, authorization, command validation, durable receipts, revisions, synchronization, transaction and migration orchestration, blob publication, supervision services, capabilities, diagnostics, backup participation, and module registration.
- Typed feature modules own concrete schemas, invariants, commands, projections, lifecycle policies, diagnostics, migrations, and semantic UI contributions. They receive versioned Host services rather than unrestricted daemon/database/network access.
- There is no universal product `Resource` aggregate. A small internal catalog may retain routing and lifecycle facts for module-owned durable objects.
- The Windows-specific behavior sits behind a versioned Host-platform operations interface so later ports do not redefine domain or protocol semantics.

### Pi worker boundary

- Run exactly one worker process for each resident Session. Bind the worker immutably to that Session for its lifetime and bundle the exact Pi SDK version with the Pidex release.
- Use only documented Pi SDK surfaces and Pi's public resource loader. Start Pi with project trust enabled for every Host path; Pidex adds no Project or Workspace trust prompt.
- Hide Pi behind a versioned, schema-validated Pidex worker protocol. Do not expose SDK objects, mirror Pi RPC as the product contract, or silently fall back to `pi --mode rpc`.
- Require exact daemon/worker protocol generation, probe required Pi behavior at readiness, fail closed on missing required semantics, and advertise optional capabilities.
- Support Pi select, confirm, input, editor, notification, status, widget, title, and editor-text injection behavior. Arbitrary custom TUI components and terminal emulation are not v1 requirements.
- Treat workers as reliability isolation, not security sandboxes. Contain every worker and descendant in a non-breakaway kill-on-close Windows Job and isolate failure to the affected Session.

### Session, Run, and Interaction behavior

- Commit Session creation before requiring a Pi artifact or worker. Keep Session creation and initial Run acceptance as distinguishable operations.
- Accept a Run only after durable validation, identity, Session-local order, command receipt, and state transition. Dispatch workers only after commit.
- Execute at most one Run per Session. Keep daemon-owned ordered follow-up Runs separate from steering events and Pi's transient queue.
- End every accepted Run exactly once as Completed, Failed, Cancelled, or Interrupted. Report normal terminal outcomes only after Pi checkpoint and Host settlement are durable.
- Target steering and Stop at the exact observed executing Run. Reject stale actions without conversion or retargeting.
- Accepted Stop cancels undelivered steering and queued follow-ups, withdraws associated Interactions, requests cooperative Pi abort for 10 seconds, then terminates only that Session Job and allows 5 seconds for reconciliation.
- Hold proven-undispatched follow-ups after Failed or Interrupted predecessors until explicit release or cancellation. Never replay uncertain mutation or auto-run held work.
- Wake on accepted Pi-requiring action. Sleep only at verified quiescence after flush. Archive only at quiescence and restore as available/sleeping.
- Fork only from a Pi-validated durable stable point. Preserve immutable ancestry and history through that point, allow an explicit valid scope override, and inherit no transient work.
- Model only Pi select, confirm, input, and editor requests as Interactions. Do not infer approval, permission, or durable grants from content.
- Serialize Interaction response, dismissal, deadline, withdrawal, and Stop races at the Host. Deliver an accepted response only to the exact worker request and never replay an unacknowledged value.
- Persist Interaction facts while excluding acknowledged input/editor plaintext from Timeline, receipts, logs, diagnostics, command results, and Device caches.

### Client protocol and consistency

- Use one authenticated version-negotiated WebSocket per Client as the control plane and HTTPS for assets, immutable Timeline pages/blobs, exports, and backup transfer.
- Give Client authoritative projections exactly two write paths: atomic Host snapshot installation or atomic Host Change Set application. Command outcomes do not patch authority.
- Negotiate protocol major/minor and stable capabilities. Unknown required semantics make the affected scope non-current and force update, reconnect, or reset.
- Use an opaque Synchronization Cursor containing Host identity, epoch, and monotonic sequence. Use independent resource revisions for concurrency preconditions.
- Synchronize a lightweight Host scope plus ephemeral detailed Session scopes. Establish every scope with a snapshot barrier and buffer later Change Sets until snapshot installation.
- Make the Session Timeline the stable Client history schema. Use stable entry identities/order, revisioned mutable tails, immutable finalized entries, and HTTP pagination for older pages.
- Make every mutation a versioned command with Device-scoped Command ID, exact targets, required capability basis, and command-specific revisions/state preconditions.
- Record durable command receipts in the acceptance transaction. Keep proof for at least 30 days. Reuse with changed content is invalid; expired or indeterminate identity never becomes new intent.
- Retain resumable synchronization changes for at least seven days. Reset incompatible scopes rather than merging cache and Host state.
- Bound per-Client outbound delivery, coalesce only schema-declared replaceable changes, and disconnect slow Clients for resynchronization without worker backpressure.

### PWA, offline, and notification behavior

- Use a close structural and visual analogue of the Codex two-pane shell: Project/Workspace-grouped Session sidebar and one conversation-focused routable View.
- On mobile, turn the same sidebar into a drawer and keep exact-target Stop directly available while executing.
- Keep View navigation independent from Session retention, residency, and execution.
- Place open Interaction controls once above the available composer, with navigation for multiple Interactions and compact Session-row waiting cues.
- Store a bounded demand-filled per-Host Device projection in IndexedDB. Mark cached mutable facts stale, retain their synchronization basis, and never infer Host absence from cache absence.
- Disable every Host mutation until required scopes are authenticated, compatible, reconciled, and current.
- Keep Composer Drafts in separate Device-owned storage, never auto-send them, and never silently evict them with replaceable domain content.
- Limit the service worker to content-addressed shell generations, offline fallback, Push receipt, notification routing, and obsolete-shell cleanup. It owns no synchronization or command behavior.
- Treat browser background execution as unavailable for correctness. Reconcile on visibility return before enabling control.
- Support optional advisory Web Push for Interactions, Run outcomes, held work, and Pi warning/error notifications. Rich preview is the disclosed default with a generic privacy option. Notification actions never issue commands.
- Revocation performs best-effort Device cleanup but makes no remote-wipe guarantee. Ordinary network or certificate failure must not destroy valid local data.

### LAN security and Device identity

- Expose one canonical private-CA HTTPS origin using a durable collision-resistant `.local` hostname and release-independent fixed high port.
- Bind HTTPS to wildcard addresses. Use Pidex-owned Windows Firewall rules as the intended Private-profile enforcement, but warn prominently and continue LAN service when enforcement is missing or unverifiable. Keep mDNS on Private-classified interfaces.
- Expose no anonymous product data. Limit unauthenticated surfaces to discovery metadata, temporary CA onboarding, and pairing exchange.
- Generate five-minute one-time pairing secrets with a small bounded failure count and consume on first success.
- Generate a non-extractable Device signing key during pairing, authenticate Clients by signed challenge into short-lived sessions, and grant every paired Device equal full v1 authority.
- Revoke a Device atomically across signing key, live Clients, connection sessions, and new Push scheduling while retaining a non-secret tombstone.
- Protect Host identity and private-CA keys with versioned DPAPI envelopes and user-only ACLs. Preserve Device identities across leaf/root rotation when Host identity and origin survive. Require reinstallation and re-pairing after origin change or Reidentify.
- Maintain a release threat model and automated OWASP ASVS Level 2 control mapping without claiming Session workers are security sandboxes.

### Persistence, updates, and operations

- Use SQLite WAL as authority for all transactional Pidex facts. Configure durability so acknowledged commits reach the required OS flush boundary.
- Keep immutable large payloads and versioned Pi artifacts in separate managed stores. Stage, flush, verify, and atomically rename bytes before publishing SQLite references.
- Retain authoritative Session, Timeline, artifact, blob, ancestry, Device, and revocation history indefinitely in v1. Garbage collect only proven unreachable data.
- Use managed versioned data generations for migration. Preflight, snapshot, stop mutations/workers, migrate, validate, and atomically activate. Copy-migrate Pi artifacts lazily through matching workers.
- Install per user, start via Task Scheduler, bundle required runtimes, run unelevated, and use a fixed-schema elevated helper only for firewall operations.
- Supervise startup with a 15-second readiness deadline and at most five retries using 1/2/4/8/16-second backoff before circuit breaker.
- Stage complete signed immutable releases, require Host-wide quiescence for activation, prohibit mixed protocol generations, and roll back only before the new release accepts mutations unless reverse migration or managed restore is available.
- Drain non-forced stop, restart, update, uninstall, and portable backup for at most 15 minutes; abort and resume acceptance rather than silently Stop. Give Windows shutdown 10 seconds before Job closure.
- Ship a signed `pidex` CLI and localhost launch-capability surface for control and recovery. Provide `pidex doctor`, bounded structured logs/crash artifacts, coarse Windows events, redacted support bundles, and no automatic telemetry.
- Preserve durable data, Host identity, CA material, artifacts, and managed backups during normal uninstall. Make destructive purge separate and strongly confirmed.

### Backup and recovery

- Enable online local recovery snapshots automatically: at most one per changed 24-hour period, protected snapshots at named risk boundaries, manual snapshots on request, and seven rolling changed-day points.
- Capture a named synchronization barrier and verified Pi checkpoints. Restore unverified execution tails as Interrupted.
- Keep recovery bytes independent from live-store files and verify database, manifest, reference closure, and object evidence.
- Make portable backups manual, Host-quiescent, passphrase-encrypted, authenticated, complete, and fully reread/verified before export. Never retain the passphrase.
- Distinguish bundle verification, transfer verification, and destination-file verification. Never rotate or delete user-owned exported files.
- Scrub live and recovery data incrementally with complete online retained-byte coverage within a monthly window. Repair only from independently verified exact copies.
- Quarantine orphans and require a second independent reachability proof before deletion.
- Reserve emergency storage headroom and enter storage-protection mode before it is consumed. Preserve reads and minimum writes for accepted settlement, Stop, revocation, cleanup, possible export, and diagnostics.
- Provide whole-Host replacement restore only. Fully verify before materialization, disclose rollback and Device risks, require explicit confirmation, preserve the replaced generation, and rotate synchronization epoch.
- Restore captured Device authorization exactly, while warning that later revocations may be rolled back. Convert captured executing/cancelling Runs to Interrupted and hold queued Runs.
- Enter Host-local recovery mode and disable LAN/mDNS when global identity, database, or authority invariants are uncertain.
- Support Reidentify only when product data verifies but trust identity cannot be recovered. Create new identity, origin, CA, epoch, and Device basis while recording broken continuity.
- Permit non-restorable encrypted evidence export for unverifiable global data, but forbid automatic salvage, row extraction, guessed relationships, silent omission, or last-write-wins repair.

### Extension seams

- Keep future workspace tooling beside Sessions. A Session may target another Host-owned object but never owns its identity, persistence, supervision, or lifetime.
- Register namespaced versioned module identities, resource kinds, protocol families, capabilities, migrations, diagnostics, lifecycle services, and semantic UI contributions before readiness.
- Make module commands, snapshots, Change Sets, worker requests, storage, backup, and lifecycle use the kernel authority envelope. Forbid opaque channels and private authoritative databases.
- Preserve missing/incompatible module identity, provenance, schema, and bytes while isolating affected kinds.
- Create future Terminals and Managed Processes as explicit Host-owned resources in separate contained Jobs, never as detached Session descendants.
- Treat a later Electron wrapper as another Device/Client and a later tunnel as a transport adapter over the same authority contracts.

### Implementation-planning parameters

- The first implementation tickets may select reversible details not fixed by the architecture: daemon/PWA stack, package boundaries, canonical port, paths, encodings, standard cryptographic algorithms and key sizes, backup container/KDF, page and queue bounds, idle sleep policy, cache budget, storage reserves, maintenance thresholds, visual tokens, and test tooling.
- Every selected parameter must be documented, configurable where operationally useful, and tested against the normative invariants and hard release gates. A choice that weakens those requirements reopens product/architecture design rather than counting as an implementation detail.

## Testing Decisions

- The dominant seam is the authenticated product boundary. Black-box tests drive the real PWA and CLI through HTTPS and WebSocket against the real daemon, authority kernel, SQLite database, immutable stores, synchronization machinery, command receipts, lifecycle orchestration, and worker supervisor.
- Replace only external or nondeterministic edges in the main harness: Pi/model/tool behavior and Windows failure points use deterministic adapters with controllable time, process loss, IPC loss, disk faults, network faults, clock jumps, and capability combinations.
- Keep narrow contract suites at two lower seams where product-level tests cannot efficiently localize compatibility: the versioned Pi worker protocol against the exact bundled Pi SDK, and the Windows platform adapter against Task Scheduler, DPAPI, certificate trust, Firewall, mDNS interface selection, Job Objects, shutdown, and release activation.
- Do not introduce broad unit-test seams for kernel internals, repositories, reducers, or persistence helpers merely to increase test count. Prefer externally observable commands, snapshots, Change Sets, Timeline facts, process outcomes, files, and CLI/PWA states.
- Test command correctness through accepted/rejected outcomes and resulting Host projections, not private function calls. Assert exact-target stale rejection, receipt deduplication, scope reset, epoch rotation, and no uncertain replay.
- Test lifecycle through the product seam: creation before dispatch, one executing Run, ordered follow-ups, held abnormal queues, Stop timing, worker containment, quiescent sleep/archive/update, and evidence-based recovery.
- Test Interactions through multiple authenticated Clients with deterministic deadline and worker acknowledgement races. Assert first-valid response, stale competitors, withdrawal, expiration, free-form redaction, and exact-request non-replay.
- Test Client consistency under dropped, duplicated, reordered, delayed, coalesced, and backpressured traffic. A Client marked `current` must equal the Host projection for every subscribed scope.
- Test offline behavior in real supported browsers: stale labeling, mutation disabling, draft persistence, service-worker upgrade boundaries, cache eviction, background suspension, Push deduplication, notification privacy, and best-effort revocation cleanup.
- Test security at public boundaries: canonical origin, TLS, anonymous-surface limits, pairing-secret expiry/failure/consumption, challenge authentication, equal authority, targeted revocation, CSRF/cross-origin defense, local launch capabilities, privileged-helper validation, update signatures, backup encryption, IPC schema validation, and redaction.
- Test persistence with deterministic crash points before and after Run acceptance, artifact flush, blob publication, SQLite settlement, migration activation, snapshot barriers, backup verification, restore activation, and Reidentify.
- Test Windows process containment with uncooperative children and attempted detachment. A failed or forced Session must not disturb sibling workers, while daemon supervision loss must tear down contained worker trees.
- Test backup and recovery using clean snapshots, executing-tail snapshots, corrupt newest point, interrupted restore, failed migration, portable identity transfer, Device revocation rollback disclosure, storage pressure, exact-byte repair, orphan quarantine, global recovery mode, and Reidentify.
- Run browser gates on current and previous Edge/Chrome for Windows, current and previous Chrome for Android, and current and previous Safari browser/standalone PWA for supported iOS/iPadOS. Unsupported browsers must fail safely.
- Run capacity gates with 10,000 Sessions, one 100,000-entry Timeline, and six Clients across three Devices. The 8 GB tier exercises four resident/two executing Sessions; the 16 GB tier exercises eight resident/four executing Sessions.
- Enforce p95 targets: cold/warm shell 3s/1s, cached/uncached Session 300ms/2s, command outcome 250ms, projection reconciliation 500ms, live output 250ms after Host receipt, resumable reconnect 3s, worker wake 5s, and daemon readiness 15s under the specified LAN baseline.
- Enforce resource gates: quiescent launcher plus daemon at 300 MB RSS and 1% average CPU, quiescent worker at 300 MB RSS, 100,000-entry Client at 300 MB JS heap, diagnostics/crash data at 1 GB, and no monotonic handle growth or more than 10% memory growth after soak returns to quiescence.
- Run a deterministic comprehensive fault matrix, a 72-hour soak, and a seven-day desktop/mobile daily-driver trial. Retries may gather diagnostics but cannot convert a blocking failure into passing evidence.
- Map automated security controls to applicable OWASP ASVS Level 2 requirements, sign every artifact, emit an artifact-linked SBOM, and block known high/critical vulnerabilities.
- The repository has no existing application test prior art. The approved PWA prototype provides UX prior art, and Pi Tin provides external chat-rendering and composer evidence only; neither defines Pidex authority, lifecycle, transport, persistence, or security semantics.

## Out of Scope

- Native mobile applications.
- Electron packaging in v1; only compatibility seams for a later wrapper are included.
- Public-internet relay infrastructure; only a future transport seam is preserved.
- Multiple Hosts, Host federation, multiple users, roles, teams, and tenant isolation.
- File browsing/editing, Git review, worktrees beyond Workspace identity, terminals, and Host-managed background processes.
- A public third-party Pidex extension ABI, dynamic discovery, package distribution, signing policy, sandbox, permissions UX, or third-party UI execution.
- Arbitrary Pi `custom()` TUI components and terminal-panel emulation.
- Destructive Session deletion.
- Application-level encryption for live Host content or Device offline content beyond the specified platform and backup protections.
- A remote-wipe guarantee for revoked Device caches.
- Automatic portable-backup scheduling or reminder policy.
- Restore-as-new-identity, Host cloning, selective restore/import, merge restore, or automatic data salvage.
- A blocking WCAG conformance claim, manual assistive-technology matrix, telemetry platform, distributed tracing system, or external penetration test for v1.
- Building later workspace tooling merely because its seams are defined.

## Further Notes

- The complete product and architecture sources are the resolved [Pidex wayfinder map](../../pidex-product-and-architecture/map.md) and its [compiled implementation handoff](../../pidex-product-and-architecture/SPEC.md). This issue intentionally reshapes those decisions for build decomposition rather than replacing their rationale.
- The canonical glossary must govern implementation names, API vocabulary, UI labels, test descriptions, and future tickets. In particular, avoid “active Session,” “idle Session,” “approval,” “permission request,” “server,” and “thread” where the glossary provides exact terms.
- The final LAN posture is deliberate: wildcard HTTPS continues serving when Windows Firewall enforcement is missing or unverifiable, while Pidex emits prominent warnings. This is not a fail-closed Private-only guarantee and must not be weakened further by anonymous access or relaxed authentication.
- Accessibility and rich observability remain explicit non-blocking v1 boundaries, not forgotten requirements. Core workflow breakage, falsely current UI, unsafe recovery, or supported-browser failure still blocks under the ordinary release gates.
- The accepted test-seam decision is one dominant product-level black-box seam, with only narrow Pi-worker and Windows-adapter contract suites beneath it.
- The next step is to split this spec into blockers-first tracer-bullet implementation tickets. Those tickets are already agent-ready and must not pass through triage again.
