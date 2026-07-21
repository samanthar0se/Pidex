# Pidex v1 Product and Architecture Specification

## 1. Status and interpretation

This document is the implementation handoff for Pidex v1. It synthesizes the resolved wayfinding decisions into one coherent product and architecture specification without introducing new product or architecture choices.

The words **must**, **must not**, **required**, and **never** are normative. Statements explicitly described as best effort, optional, advisory, or outside v1 are not release requirements except where their failure behavior is specified.

The source decisions remain the rationale and detailed decision record:

- [Define the core product promise](issues/01-define-core-product-promise.md)
- [Establish the ubiquitous language](issues/02-establish-ubiquitous-language.md)
- [Choose the Pi runtime boundary](issues/03-choose-pi-runtime-boundary.md)
- [Define session lifecycle and recovery](issues/04-define-session-lifecycle-and-recovery.md)
- [Design client-daemon consistency](issues/05-design-client-daemon-consistency.md)
- [Set the LAN trust boundary](issues/06-set-lan-trust-boundary.md)
- [Design the PWA information architecture](issues/07-design-pwa-information-architecture.md)
- [Choose persistence and ownership](issues/08-choose-persistence-and-ownership.md)
- [Define Windows daemon operations](issues/09-define-windows-daemon-operations.md)
- [Preserve workspace and extension seams](issues/10-preserve-workspace-extension-seams.md)
- [Set the quality and acceptance bar](issues/11-set-quality-and-acceptance-bar.md)
- [Define the human interaction and approval model](issues/13-define-human-interaction-and-approval-model.md)
- [Define offline cache and background behavior](issues/14-define-offline-cache-and-background-behavior.md)
- [Define backup and data recovery operations](issues/15-define-backup-and-data-recovery-operations.md)
- [Specify Host-global Session read tracking](https://github.com/samanthar0se/Pidex/issues/132)

## 2. Product definition

### 2.1 Promise

Pidex v1 gives one developer a complete daily-driver interface for Pi through installable desktop and mobile PWAs on the local LAN, backed by one configured Windows Host. The developer must not need to return to a Host-local Pi UI for any core Session action.

The Host owns execution. Sessions and accepted work continue independently of browser tabs, network connections, Device sleep, PWA suspension, reloads, and ordinary daemon or Host restarts.

### 2.2 Required workflows

The PWA must support:

- creating an empty Session or creating a Session with an initial Run;
- finding, opening, renaming, archiving, restoring, waking, resuming, and forking Sessions;
- reading the complete Session Timeline and streaming live output and state;
- composing prompts and supported inputs;
- selecting model and mode options exposed by the negotiated Pi capability set;
- steering the exact executing Run and creating ordered follow-up Runs where supported;
- answering or dismissing structured Pi Interactions;
- stopping the exact executing Run observed by the user;
- moving between authenticated Devices and operating through several Clients concurrently; and
- recovering authoritative state after disconnect, reload, daemon restart, worker failure, Host restart, and defined restore operations without losing, duplicating, or silently replaying accepted work.

### 2.3 Release boundary

V1 supports one Windows Host, one developer, multiple paired Devices, multiple simultaneous Clients, and an unbounded retained-Session model constrained only by measured Host resources. It must not impose an artificial persistent-Session cap.

V1 includes Pi's core conversation and Session capabilities exposed through the supported official Pi SDK boundary. Required capabilities fail closed when unavailable; explicitly optional capabilities are negotiated and omitted or disabled in Clients.

V1 preserves architectural seams, but does not deliver:

- file management, Git review, worktree management, terminals, or managed background processes;
- Electron packaging or native mobile applications;
- public-internet relay infrastructure or multiple Hosts;
- multiple users, roles, teams, tenants, or per-Device authorization scopes;
- arbitrary Pi `custom()` TUI components or terminal-panel emulation;
- a third-party Pidex-native extension loader, package format, sandbox, permission system, or distribution mechanism; or
- destructive Session deletion.

### 2.4 Success definition

Release requires a seven-day daily-driver trial using desktop and mobile Pidex Clients for real Pi work without another Pi UI for core Session actions and without a Severity 1 or Severity 2 defect. The full release gates are specified in section 17.

## 3. Canonical domain model

Implementations, APIs, schemas, UI copy, tests, and plans must use the glossary in [CONTEXT.md](CONTEXT.md). The following relationships and distinctions are architectural invariants.

### 3.1 Ownership and identity

- A **Host** is one authoritative Pidex installation.
- A **Project** is a durable logical grouping and may contain Workspaces.
- A **Workspace** is a concrete working copy or execution environment and belongs to exactly one Project.
- A **Session** is a durable conversation with immutable optional Project and Workspace scope.
- A **Run** is one accepted execution cycle and belongs to exactly one Session.
- A **Session Timeline** is the Host-owned ordered product history for one Session.
- An **Interaction** is one Host-owned Pi request of kind `select`, `confirm`, `input`, or `editor`.
- A **Device** is one paired app installation or browser profile, not a physical machine.
- A **Client** is one live tab or app context belonging to a Device.
- A **View** is an ephemeral Client-local projection and has no Host identity.
- A **Composer Draft** is Device-owned, non-authoritative, and never a queued Run.

Every durable identity is immutable, opaque, Host-local, and type-qualified. Paths, names, process IDs, ports, URLs, Git references, and provider handles are attributes or locators, not durable identities.

### 3.2 Independent state axes

Session retention and runtime residency are independent:

- retention is **available** or **archived**;
- residency is **resident** or **sleeping**; and
- Run state is **queued**, **executing**, or one terminal outcome.

The implementation must not use “active Session” or “idle Session” as domain states. It must name the exact retention, residency, Run, Interaction, or View state.

### 3.3 Lifecycle vocabulary

- **Open / Close** changes only a View.
- **Wake / Sleep** changes only Pi runtime residency.
- **Archive / Restore** changes only Session retention.
- **Create / Resume** creates a Session or continues it with new work.
- **Fork** creates an independent child Session from a validated stable history point.
- **Reidentify** creates a new Host trust identity around verified product data when old trust keys cannot be recovered.

## 4. System architecture

### 4.1 Required components

Pidex v1 consists of these logical components:

1. **Stable Host launcher** — starts at user logon, enforces one Host instance, selects and supervises versioned daemon releases, activates updates, rolls back safe failed activations, and owns the daemon supervision Job.
2. **Host daemon and authority kernel** — owns authentication, commands, durable receipts, domain invariants, transactions, revisions, synchronization, lifecycle orchestration, capabilities, diagnostics, backup participation, and module registration.
3. **Session worker supervisor** — creates one isolated Node worker per resident Session and owns worker protocol, checkpoints, cancellation, crash isolation, and Job containment.
4. **Pinned Pi workers** — each embeds the exact Pi SDK version shipped with its Pidex release and is immutably bound to one Session for its lifetime.
5. **Persistence subsystem** — one SQLite authority store, immutable blob storage, versioned Pi artifacts, recovery generations, and managed backup stores.
6. **HTTPS and WebSocket edge** — serves the canonical PWA origin, authenticated APIs, immutable data, exports, pairing, synchronization, and commands.
7. **PWA Client** — renders Host projections, issues preconditioned commands, manages Views and Device-owned state, and never becomes a domain authority.
8. **Service worker** — serves a versioned application shell, offline fallback, Web Push, and cache-generation cleanup only.
9. **Windows platform adapter** — implements Task Scheduler, DPAPI, certificate trust, firewall inspection and repair, mDNS interface selection, Job Objects, shutdown handling, OS event reporting, and atomic release activation.
10. **Privileged firewall helper** — performs only fixed-schema Pidex firewall operations after explicit elevation.
11. **Control CLI and localhost recovery surface** — provide Host-local setup, control, diagnosis, pairing, revocation, update, backup, restore, and recovery.

These may be packaged together where allowed, but their authority and failure boundaries must remain explicit.

### 4.2 Authority kernel and modules

The authority kernel must remain small. Feature modules own concrete schemas, invariants, commands, projections, lifecycle policy, diagnostics, migrations, and semantic UI contributions. Modules receive explicit versioned Host services rather than daemon object graphs, unrestricted database handles, raw network listeners, or direct Client state.

The kernel owns the common envelope: identity registration, authentication, authorization, validation, Command IDs, receipts, revisions, cursors, scope barriers, transaction orchestration, blob publication, supervision, capability negotiation, backup orchestration, and failure isolation.

There is no universal product-level `Resource` aggregate. A small internal catalog may retain type-qualified identity, module and version, valid scope, revision, availability, and provenance for lifecycle-bearing objects.

## 5. Pi runtime boundary

### 5.1 Worker contract

Each resident Session has exactly one worker process. A worker:

- is bound to one Session for its lifetime;
- imports only documented public Pi SDK surfaces;
- uses Pi's public resource loader;
- runs with project trust enabled for every working directory;
- exposes only a versioned, schema-validated Pidex worker protocol;
- never exposes SDK objects or Pi private formats to the daemon or Client;
- advertises optional capabilities and fails readiness when a required capability is absent; and
- must exactly match the daemon's worker-protocol generation.

`pi --mode rpc` is neither the primary runtime nor a silent fallback. Pidex owns create, resume, wake, sleep, fork, and worker replacement. Pi's in-file conversation-tree navigation may remain within the bound worker.

The required Pi UI bridge covers `select`, `confirm`, `input`, `editor`, notifications, keyed status, widgets, title, and editor-text injection. Arbitrary custom TUI rendering is outside v1.

### 5.2 Isolation and trust

Worker isolation is a reliability boundary, not a security sandbox. Workers, Pi extensions, tools, and descendants run with the signed-in Windows user's filesystem, process, credential, and network authority.

A worker crash, hang, memory leak, malformed message, IPC loss, or unhandled exception must affect only its Session. Every pending daemon-to-worker request must terminate with a typed outcome. The daemon must validate every worker message before it can affect authority.

Each worker starts suspended, is assigned to its own non-breakaway Windows Job Object with kill-on-close, and resumes only after successful assignment. Descendant shells, tools, extensions, grandchildren, and attempted detached processes must remain in that Job. A future long-lived process must be created as a separately Host-owned resource, never detached from a Session worker.

## 6. Session and Run lifecycle

### 6.1 Creation and acceptance

The daemon is authoritative for Session identity, Run identity, Session-local Run order, lifecycle, and terminal outcomes.

A new Session is committed as available and sleeping before a worker or Pi artifact is required. It may remain empty. When the user submits an initial prompt, Session creation and Run acceptance remain distinguishable operations; an empty Session survives failure to accept or execute its first Run.

A prompt becomes a Run only after the daemon validates it, assigns identity and order, commits its acceptance and receipt durably, and acknowledges acceptance. Rejection before this boundary creates no Run. Every accepted Run must eventually have exactly one visible terminal outcome.

### 6.2 Execution and queues

A Session executes at most one Run at a time. The daemon, not Pi's in-memory queues, owns accepted follow-up Runs and their order.

- **Steering** targets the exact executing Run and becomes an event within that Run.
- **Follow-up** creates a separate queued Run.
- Steering received after its target stops executing is rejected as stale and is never converted into a follow-up.

A Run remains executing across model turns, tool calls, steering, retries, compaction retries, and unresolved Run-associated Interactions. A lower-level turn or `agent_end` event is not a Run boundary. Normal completion occurs only after Pi settles and required history is durable.

Queued follow-ups start automatically only after the predecessor completes. A failed or interrupted predecessor holds proven-undelivered queued Runs for explicit release or cancellation. Recovery never automatically runs them against possibly partial context.

### 6.3 Terminal outcomes

Every accepted Run reaches exactly one terminal outcome:

- **Completed** — Pi settled normally and resulting history is durable.
- **Failed** — Pi settled with an unrecovered model or runtime error. Tool errors handled inside the conversation do not alone fail the Run.
- **Cancelled** — an accepted user or Host cancellation stopped the Run.
- **Interrupted** — normal completion cannot be proved after unexpected loss or irreconcilable state.

Partial output, tool results, filesystem changes, processes, network effects, and extension side effects are not rolled back by cancellation or interruption.

### 6.4 Stop semantics

Stop targets the exact executing Run observed by the user. If that Run has ended, Stop is rejected as stale and must not retarget a successor.

Accepted Stop:

1. marks the target as cancelling;
2. cancels undelivered steering and all queued follow-up Runs in the Session;
3. withdraws open or resolving Interactions associated with that Run;
4. clears transient runtime queues and requests cooperative Pi abort;
5. waits up to 10 seconds for settlement;
6. terminates only that Session Job if settlement does not occur; and
7. allows up to 5 seconds to reconcile authoritative state before reporting completion.

Forced termination after accepted Stop still produces **Cancelled**, because it fulfills accepted cancellation intent. Stop does not withdraw unrelated Session-level command Interactions.

### 6.5 Wake, sleep, archive, and restore

Opening or reading a Session never wakes it. An accepted action that requires Pi wakes an available sleeping Session on demand.

A Session may sleep only at a verified quiescent boundary: no executing, queued, held, or cancelling Run; no unresolved Interaction; and no retry, compaction, or lifecycle mutation. Required state must be flushed first. Closing the last View may influence an idle policy but is never itself a sleep command.

Archive is accepted only for a quiescent Session. It must not silently stop or drain work. A UI may offer an explicit Stop-then-Archive sequence as separate actions. Successful Archive makes the Session archived and sleeping. Restore makes it available and sleeping. Archived Sessions remain readable, exportable, restorable, and valid Fork parents.

### 6.6 Fork

A Fork may be created from any durable history entry the pinned Pi runtime validates as a safe branch point. Streaming or partial entries are ineligible.

The Fork is a new available, sleeping Session with immutable parent and fork-point ancestry. It inherits durable history through the fork point and inherits Project and Workspace scope by default, with an explicit valid scope override allowed at creation. It inherits no worker, executing or queued Run, steering, Interaction, cancellation state, or transient runtime work.

### 6.7 Restart and abnormal recovery

A planned daemon restart drains by default: it rejects new mutations, lets accepted work settle, flushes state, and stops workers. If a non-forced stop, restart, update, uninstall, or backup cannot drain within 15 minutes, it aborts and resumes normal acceptance. It never silently escalates to Stop. An explicit force applies normal Stop semantics.

After unexpected worker, daemon, or Host loss, the daemon reconciles durable acceptance records, Pi artifacts, and worker checkpoints before assigning outcomes. It may recover Completed, Failed, or Cancelled only when evidence proves that state. Otherwise an executing Run becomes Interrupted. Missing processes never prove completion, and uncertain mutations are never replayed to discover whether they committed.

Proven-undispatched follow-ups remain accepted but held. Undelivered steering is recorded as unapplied and never migrates to another Run. Partial recovered Timeline content remains attached to the interrupted Run. The Session becomes sleeping until explicit work wakes a replacement worker.

## 7. Interactions

### 7.1 Model

Pidex models every response-bearing Pi request as an Interaction with kind `select`, `confirm`, `input`, or `editor`. It must not infer approval, permission, danger, or durable grant semantics from request text or extension identity.

Each Interaction has immutable identity, Session identity, optional Run identity, worker generation and correlation, available extension provenance, kind-specific payload, creation time, optional absolute Host deadline, state, and monotonic revision. Payloads are bounded, schema-validated, and rendered as inert text.

Kind validation is exact: select answers must be offered values, confirm answers are booleans, and input/editor answers are bounded strings.

### 7.2 State machine and races

An Interaction begins **open**, may become transiently **resolving**, and reaches exactly one terminal state:

- **responded** — the exact worker acknowledged consuming the submitted value;
- **dismissed** — the exact worker acknowledged explicit user dismissal;
- **expired** — the Host deadline won before response acceptance; or
- **withdrawn** — Pi or the Host stopped awaiting the response because of abort, applicable Run termination, Stop, worker loss, or invalidation.

The Host serializes deadline, response, dismissal, withdrawal, and Stop transitions. The first valid committed transition wins. Any paired Device may answer. A response command targets exact Interaction identity, worker generation, and observed revision. The first valid Host acceptance reserves it; later races are stale.

If the Host accepts a response but the exact worker does not acknowledge it before loss or withdrawal, the Interaction becomes withdrawn and records that application is unproven. The value is never replayed to a replacement request or worker.

### 7.3 Deadlines, dismissal, and retention

Only an extension-declared timeout creates a deadline. The Host converts it once to an absolute authoritative deadline. Client timers are illustrative. Reconnect, View changes, Device changes, or inactivity do not restart or extend it. Untimed Interactions may remain open indefinitely and prevent Session quiescence.

Dismiss targets one Interaction and returns Pi's cancellation/default value; it does not imply Run Stop. Worker loss withdraws all unresolved Interactions for that worker generation.

Interaction creation, state, terminal cause, timestamps, provenance, and responding Device are durable Timeline facts. Confirm and select responses may be durable. Plaintext input and editor responses exist only long enough to deliver to the exact worker and must be excluded after acknowledgement from Timeline content, command results, logs, diagnostics, receipts, and Device caches; receipts retain only a digest and outcome.

Notifications, status, widgets, title, and editor-text injection are presentation effects, not Interactions. Worker-generation presentation state disappears when cleared, replaced, or invalidated. A Pi title update never renames the Session.

Editor-text injection from a Client-invoked extension command targets only that Client's matching Session View and observed Composer Draft revision. If the View is gone or the draft changed, the Host must not overwrite, broadcast, or reroute it; the text becomes a non-destructive suggestion a Client may explicitly apply.

## 8. Client-daemon consistency

### 8.1 Transport and projections

Each Client uses one authenticated, version-negotiated WebSocket control plane for synchronization scopes, snapshots, Change Sets, commands, command outcomes, acknowledgements, heartbeats, and connection state. HTTPS is the data plane for application assets, immutable Timeline pages, content blobs, exports, backup transfer, and bootstrap surfaces.

The Host is the sole authority for shared state. A Client projection has exactly two authoritative write paths:

1. atomically install a Host snapshot; or
2. atomically apply a Host Change Set.

A command response must not patch authoritative projection state. The issuing Client may show a clearly non-authoritative pending overlay until the Host stream reaches the command's commit cursor.

### 8.2 Protocol and capabilities

The opening handshake binds the connection to expected Host identity and negotiates a compatible protocol major and minor. Minor versions may add ignorable fields and negotiated behavior without changing existing semantics. No common major produces `update required`, not silent downgrade.

The Host advertises stable versioned capability identifiers and constraints, including worker-derived optional capabilities. Commands declare required capabilities. Unsupported controls are omitted or disabled, and unsupported commands are rejected.

Schemas must define which optional fields are ignorable. An unknown Change type, unsupported required capability, or unknown semantic transition is a protocol fault. The Client must stop applying that affected projection and reconnect, reset, or update; it must not skip the transition while claiming to be current.

### 8.3 Cursors, revisions, and Change Sets

Every committed user-visible Host change advances one Host-wide monotonic synchronization sequence. The externally carried Synchronization Cursor is opaque and contains durable Host identity, synchronization epoch, and sequence.

Normal restarts preserve continuity. Backup restore, continuity-breaking migration, synchronization-log rebuild, Reidentify, or possible rollback rotates the epoch. A different Host identity aborts reconciliation.

Each atomic commit emits one cursor-stamped typed Change Set. Relevant sequence values observed by a scoped Client increase but need not be contiguous. Every mutable resource also has a monotonic resource revision. Deltas state required base revision and resulting revision. A base mismatch makes the affected scope non-current and requires reset.

Typed projection changes include summary upsert/removal, Timeline append/revision, output delta, Run state, Interaction state, and lifecycle notices. Generic JSON Patch, persistence events, and Pi SDK objects are forbidden as Client contracts.

The Client applies a Change Set and its cursor in one local transaction, then acknowledges. Delivery is not acknowledgement. Application failure reconnects from the prior committed cursor and permits safe redelivery.

### 8.4 Scopes and snapshots

Every Client synchronizes a lightweight Host scope containing capabilities and discovery/supervision summaries. It separately subscribes to detailed Session scopes needed by Views. Subscription is delivery interest only and never changes lifecycle.

Every new or reset scope uses a snapshot barrier. The Host captures a snapshot stamped with scope, cursor, resource revisions, protocol version, and capability basis; buffers later relevant Change Sets; and sends them only after atomic snapshot installation. Adding a scope later creates a new barrier for that scope.

A Session snapshot includes metadata, executing and queued Runs, unresolved Interactions, and a bounded recent Timeline window. Stable HTTP cursor pagination exposes all older finalized entries. The WebSocket covers the mutable tail and new entries.

Temporary transport loss preserves Client identity, scope requests, cached projections, pending Command IDs, and last committed cursor. Reconnect resumes if compatible retained changes exist; otherwise the Host explicitly resets affected scopes. Reload creates a new Client under the same Device.

### 8.5 Session Timeline

The Session Timeline is a Host-owned ordered projection over prompts, assistant/model output, tool activity, Interactions, Run boundaries and outcomes, and user-visible lifecycle and recovery facts. Pi history is an input, not the Client schema or authority.

Every live entry has stable identity, order key, and monotonic revision. Deltas state base and resulting revisions. The Host may coalesce runtime output rather than preserve token boundaries. A scope snapshot contains the consolidated current entry. Finalized entries are immutable; corrections and later recovery facts append new entries.

### 8.6 Commands and receipts

Every mutation is a versioned command carrying:

- a Device-scoped unique Command ID;
- exact target identities;
- required capability basis; and
- command-specific preconditions over observed revisions or states.

The Host serializes commits and re-evaluates preconditions at acceptance. It may accept through unrelated changes, but must reject intent invalidated by a race. It must never retarget, convert, merge, or overwrite stale intent. Rejections identify the failed precondition and current revisions or a reconciliation pointer.

The same SQLite transaction that accepts a domain change records a durable receipt with Command ID, envelope digest, authoritative outcome, and commit cursor. Retrying an identical command returns the recorded outcome without re-execution. Reusing an ID with different content is rejected. Rejected outcomes may also be recorded.

Receipts remain provable for at least 30 days after terminal outcome. Once proof expires, retry is `expired` or `indeterminate`; it never becomes new intent. This provides at-most-once Host command handling, not transactional external side effects.

Command outcomes and Change Sets may arrive in either order. Clients correlate them but change authority only through the stream.

### 8.7 Backpressure

Each Client has a bounded outbound queue. Only schema-declared replaceable changes may be coalesced. A Client that cannot keep up is disconnected with a typed resynchronization reason and later resumes or resets from its last acknowledged cursor.

A slow, disconnected, crashed, backgrounded, revoked, or incompatible Client must never backpressure a worker, delay Run settlement, or block sibling Clients.

Resumable synchronization changes remain available for at least seven days. Older or incompatible cursors receive authoritative resets without affecting Timeline retention.

### 8.8 Host-global Session read tracking

Every Session has one monotonic **Session read-through position** shared by all paired Devices. The Host derives **Session read status** by comparing that position with the nullable **unread-milestone basis**. Only an Interaction opening or a Run becoming Completed, Failed, Cancelled, or Interrupted is an **unread-producing milestone**. Streaming output, intermediate Run progress, user-originated actions, and other Timeline activity do not produce unread status.

`SessionReadState` is one atomic projection containing `readThroughTimelineRevision`, Host-derived `readStatus`, and a positive `readStateRevision`. Every catalog and Session projection, snapshot, reset barrier, and independent resource basis must include it. The read-state revision advances exactly when the exposed read state changes and is independent of Timeline and metadata revisions. Read status and Session attention summary remain independent facts.

A new empty Session starts read through its initial Timeline revision at read-state revision 1. A forked child starts read through its copied tail at revision 1; copied history is read and the parent is unchanged. Archive, restore, residency changes, and non-producing Timeline activity preserve read state.

A current View may create mark-read intent only after committing and visibly presenting an exact authoritative Timeline tail while the Client is current, active, foreground, and scrolled to a visible tail sentinel. A loading View, another View, a background or hidden Client, content above the tail, and cached or offline presentation are ineligible. The command carries only Device-scoped Command ID, Session ID, exact `presentedTimelineRevision`, and exact `session.read-state` capability basis; View identity, presentation grants, and observed read state are not Host contracts.

The Host validates that exact presented revision and atomically sets read-through to the maximum of it and the current position. It never substitutes a newer Host tail, clamps a future revision, or defers an invalid command. A covered valid revision is an accepted no-op; an unknown Session or invalid revision is rejected. Therefore a View that presents revision R cannot acknowledge a later milestone that races with it.

Mark-read uses authenticated Device identity plus Command ID for durable idempotency. Its receipt, effect, synchronization record, and authority commit are atomic. An exact retry replays its recorded outcome byte-for-byte; changed-envelope reuse is `command-id-conflict`. Known-Session outcomes include authoritative read state and a reconciliation cursor. Mark-read never increments Timeline or metadata revisions and never emits an advisory notification.

Read-state changes are published only as cursor-ordered `session.read-state-changed` Change Sets to every Device, whether or not it holds a detailed Session scope. Each Device maintains one canonical read state per Session across catalog, cached, and current projections: higher read-state revisions replace lower ones, lower revisions are ignored, and equal revisions must be byte-identical. Malformed state or equal-revision divergence discards the affected authority and requires resynchronization; a Device must not invent a default. A Device persists the Host cursor only after its associated changes and canonical state are durable.

Protocol 1.2 requires exact Host and Device negotiation of the indivisible `session.read-state` capability at version 1 before authoritative projections are sent. There is no degraded mode, legacy migration, mixed-version continuity, cache conversion, feature disable, or rollback path. Reconnect reconciles canonical state before replaying only an unresolved command's exact identity and envelope. A reset installs current read state. Any optimistic current-View treatment is command-bound and non-persisted, never affects discovery, and clears on authoritative advance, outcome, rejection, reconnect, reset, or inconsistency.

Authority persists read-through, read-state revision, and nullable unread-milestone basis in the same SQLite authority as Timeline facts, receipts, and synchronization records; read status is never persisted independently and milestone basis is never exposed to Devices. Startup and authority verification validate their invariants. Recovery may repair read authority only when intact evidence proves one unique result in a fresh Authority generation; ambiguity fails closed. Snapshots, backups, restore, fallback, and rollback move Timeline and read authority together and never merge a newer read maximum into an older generation. Synchronization compaction changes delivery only and uses the existing reset barrier outside retained history.

## 9. LAN trust, identity, and security

### 9.1 Trust boundary

V1 trusts the configured Host, signed-in Windows user, entire Host filesystem and execution environment, and networks classified as Private in Windows. Any paired Device has the complete Pidex product authority and can indirectly exercise the Windows user's Pi, filesystem, process, credential, and network authority.

Pidex adds no Project, Workspace, or path trust gate. Workers start with Pi project trust enabled. Users requiring stricter controls must provide them outside Pidex v1.

No product data or control is anonymous. Unpaired clients receive only minimal discovery metadata, temporary CA-onboarding content, and pairing exchange. Projects, Workspaces, Sessions, Timeline data, capabilities, status, APIs, WebSockets, and commands require Device authentication.

### 9.2 Exposure and canonical origin

The Host exposes one canonical HTTPS origin consisting of a durable collision-resistant `.local` hostname derived from Host identity and one release-independent fixed high port. Setup checks for an mDNS collision before committing the origin. Windows computer rename, network change, and release update must not silently rename a committed origin. Authenticated APIs enforce this origin; aliases and raw IP addresses are not equivalent app origins.

The HTTPS listener binds wildcard addresses. Pidex-owned Windows Firewall rules are the only Private-profile enforcement for TCP exposure. Missing, disabled, broadened, policy-overridden, or unverifiable rules cause persistent high-severity warnings but do not stop LAN service. This warning-only behavior is the final v1 decision and supersedes any earlier implication of fail-closed Private-only exposure.

mDNS remains restricted to Private-classified interfaces even when firewall enforcement is degraded. An explicit Host-local override may broaden firewall policy.

### 9.3 Host identity and private CA

The Host has durable cryptographic identity independent of TLS certificate and DNS name. Pidex manages a private CA and leaf certificate for the canonical origin. Host and CA private keys live in versioned DPAPI-protected envelopes under user-only ACLs. Only the public root is installed in the Current User trust store.

Leaf renewal preserves origin, Host identity, and Devices. Root rotation is explicit and may overlap old and new roots. If Host identity and canonical origin survive, replacing a lost CA and re-trusting the new root preserves paired Device identities and browser-origin state. Changing canonical origin is an explicit migration requiring PWA reinstallation and Device re-pairing; Host domain data remains.

### 9.4 Discovery and bootstrap

The Host advertises `_pidex._tcp.local` only on Private interfaces. Records contain only canonical hostname and port, friendly label, discovery protocol version, and short Host-identity fingerprint. They contain no pairing state, secrets, Project, Session, runtime, or Device data.

QR, manual canonical hostname, and manual IP entry are deterministic discovery/bootstrap fallbacks. Product navigation and authentication still converge on the canonical origin. Discovery is only a location hint.

A Host-local action may temporarily open an HTTP endpoint under the same firewall policy to serve only onboarding instructions and the public CA certificate. It accepts no credentials or commands and closes automatically. All pairing and product traffic use HTTPS; there is no authenticated HTTP fallback.

### 9.5 Pairing and Device authentication

A Host-local action creates a one-time pairing secret that:

- is shown as QR and manual entry;
- expires after five minutes;
- permits only a small bounded number of failures;
- is consumed by the first successful pairing; and
- never appears in discovery, HTTP bootstrap, logs, or product state.

Possession is sufficient; no second approval click is required.

During pairing, the browser profile or app generates a non-extractable signing key and registers its public key as a Device. Startup and reconnect use signed challenge authentication to establish a short-lived connection session. Pidex must not store a replayable long-lived bearer credential. Pairing persists until explicit revocation.

All paired Devices are equal. V1 has no read-only role, Device scope, or capability grant. Pairing UX must state the full authority and local sensitive-data implications.

### 9.6 Revocation

The localhost administration surface or any paired Device may revoke another Device. Revocation atomically rejects the key, invalidates connection sessions, terminates live Clients, stops new push scheduling, and retains a non-secret audit tombstone. It does not rotate the CA or affect other Devices.

When a Client or service worker receives an authenticated revocation result, it best-effort deletes signing key, push subscription, Composer Drafts, preferences, projections, Timeline pages, blobs, and Host-specific metadata. Revocation cannot guarantee remote erasure. Offline or copied caches may remain until the Device learns of revocation; network or certificate failure must not be misclassified as revocation.

## 10. PWA information architecture

### 10.1 Desktop shell

The v1 UI is a close structural and visual analogue of the quiet Codex desktop shell: one persistent discovery sidebar and one conversation-focused main pane. The [responsive prototype](prototypes/pwa-information-architecture/README.md) is the concrete reference.

The sidebar includes:

- New Session;
- Archived discovery and restore;
- available Sessions grouped by Project and then Workspace, with Project-scoped and unscoped groups;
- search and lightweight filtering;
- compact state cues without state-priority regrouping; and
- fixed Host connection state, last authoritative synchronization time, Device identity, and settings.

Sessions within groups are ordered by recent authoritative activity. A Device-local unread-only filter composes with search for available and archived catalogs without changing hierarchy or recency order. Rows, counts, and filters use canonical Host read state rather than current-View optimism. Cues and assistive-technology semantics expose unread status independently from Session attention summary; neither visual styling nor a combined priority state may collapse `unread`, `needs response`, and `working`.

The main pane contains Session name, Project/Workspace context, capability-dependent model and mode controls, exact-target Run actions, Timeline, pinned Interaction controls, and composer.

V1 has no Host-wide Attention destination, supervision dashboard, internal Session tab strip, or split view.

### 10.2 Routable Views

One app surface shows one routable Session View. Sidebar selection changes a stable resource URL. Browser back/forward works normally, and browser tabs or windows provide parallel Views.

Opening, selecting, navigating away, replacing, reloading, or closing a View never wakes, sleeps, archives, restores, or stops a Session.

### 10.3 New Session

New Session opens a Client-local blank compose View with scope, runtime options, and Device-local draft. Navigating away creates no Host object. First submit explicitly creates the durable Session and then accepts the initial Run as distinguishable operations. A secondary action may create an intentionally empty Session.

### 10.4 Interaction presentation

An open Interaction adds a compact waiting cue to the Session row and a non-interactive Timeline fact. Live response controls appear exactly once, pinned above the still-available composer. They are not modal and are not duplicated as interactive Timeline controls.

With several open Interactions, the pinned area shows one of N with navigation. Timed Interactions order by earliest Host deadline, followed by untimed Interactions in creation order. Terminal or withdrawn Interactions leave the pager and remain as durable Timeline outcomes. Multi-Device races reconcile through the ordinary pending-intent and Host-authority model.

### 10.5 Mobile

Mobile uses the same hierarchy. The sidebar becomes a slide-over drawer opened from the Session header. Selecting a Session closes it. The Timeline, Interaction area, and composer remain primary. Secondary header actions move into overflow; exact-target Stop remains directly reachable while a Run executes.

When the drawer is hidden and the Client is not current, a compact persistent state row appears below the Session header.

## 11. Offline, background, and notifications

### 11.1 Device cache

A paired Device keeps a bounded, demand-filled working set, not a Host mirror. It may retain:

- versioned application shell and offline navigation fallback;
- last atomically synchronized lightweight discovery and supervision summaries;
- detailed projections for Sessions the Device opened, including the last observed mutable tail; and
- fetched finalized Timeline pages and immutable blobs.

Every cached domain record carries Host identity, synchronization epoch and cursor, protocol/cache schema basis, scope, relevant resource revisions, and last successful Host synchronization time. Absence from cache never proves absence from Host. A cached live entry is explicitly incomplete.

Structured projections live in a per-Host IndexedDB store and advance transactionally under the same snapshot and Change Set rules. Authenticated HTTP and Timeline responses use `no-store`; the service worker must not treat opaque HTTP cache entries as authority. Immutable bodies enter offline storage only after application-level metadata and content-identity verification.

Pidex adds no content encryption or cache unlock secret. It relies on browser-profile and Device OS protections and must disclose that cached coding data can contain secrets.

### 11.2 Staleness and reconnect

Every affected scope visibly reports `offline`, `reconnecting`, `current`, `update required`, or `revoked` and shows last authoritative synchronization time. Cached Run, Interaction, output, warning, countdown, and capability state must never look current merely because it is cached.

All Host mutations remain disabled until required scopes reconcile under a compatible basis. Cached content may remain visible with stale treatment. Reconnect verifies origin, Host identity, Device authorization, and protocol basis before resume or explicit reset. Cached and Host facts are never merged by timestamp.

Last-synchronized Session read status may remain visible offline only with the same explicit stale treatment. Offline presentation cannot create new mark-read intent or make discovery state appear current.

### 11.3 Drafts and uncertain commands

Pidex has no offline command queue. Reconnect never submits a prompt, follow-up, steering, Stop, Interaction response, lifecycle action, setting, extension command, or Composer Draft automatically.

A Device may persist minimal material for a command sent while current whose outcome became transport-uncertain. Reconnect may query the receipt or retry the exact envelope under the original Command ID and validity context. It must not change content, preconditions, target, or ID, and must not execute after `expired` or `indeterminate`.

Composer Draft persistence is separate from replaceable projections and must not be silently evicted. A persistence or migration failure is surfaced while text remains in memory.

### 11.4 Service worker and updates

The service worker may install and serve a content-addressed shell, provide offline navigation, receive Push, route notification clicks, and remove obsolete shell generations. It must not own a live connection, continuously synchronize, decide order, accept commands, or transparently cache authenticated APIs.

A complete verified shell generation becomes eligible before activation. A waiting worker activates only after explicit reload or all older Clients close. Clients first attempt to persist Device-owned state. Cache-schema migrations are versioned and atomic; disposable projections may reset, but signing keys, preferences, and drafts are separate and must not be silently lost.

### 11.5 Background behavior

Correctness never depends on a Client or service worker staying alive. Once a page is hidden, frozen, suspended, or terminated, Pidex guarantees no continuing WebSocket, stream, refresh, timer, or command delivery. On visibility return it assumes stale state and reconciles before control.

Background Sync, periodic sync, and similar APIs may be optional optimizations only. Their absence or throttling cannot lose Host work, alter deadlines, create commands, or make cache look current.

### 11.6 Web Push

Optional permission-gated Web Push is best effort and may depend on internet browser push services. It has no completeness or deadline guarantee.

Default notification-eligible facts are:

- newly open Interaction;
- every Run terminal outcome;
- held queued work after failed or interrupted predecessor; and
- Pi warning or error notification.

Routine output, keyed status/widgets, title, successful synchronization, and ordinary informational activity remain in-app by default.

Session read-state transitions, mark-read commands, synchronization, and recovery never create advisory notifications. Notification eligibility remains tied to the underlying Host facts above, so acknowledging a fact cannot create a notification feedback loop.

System notifications use rich previews by default, after UX disclosure, and never include input/editor Interaction Responses. Each Device must offer a generic-text privacy mode. Push payloads are encrypted, bounded, versioned event hints with stable event and Host identity, event time, and preview data. They report a past Host fact, never current authority. Notification actions only open and reconcile the canonical PWA; they never issue Host commands.

### 11.7 Cache cleanup

Each Device has a configurable byte budget. Application eviction removes least-recently-viewed finalized pages and blobs first, then older detailed projections, preserving lightweight summaries when practical. Browser/OS eviction remains permitted. The app requests persistent storage where supported and exposes usage, configured budget, persistence status, and controls to clear Session cache or all local Pidex data.

Clearing Session cache retains pairing and explicitly retained drafts. Clearing all local data warns that drafts and Device identity will be lost and re-pairing will be required.

## 12. Persistence and durability

### 12.1 Single authority per fact

Durable facts have exactly one authority. Copies elsewhere are references, projections, caches, or recovery evidence; disagreement is never resolved by timestamp or last-write-wins.

- **SQLite** owns Host domain state: identities, Projects, Workspaces, Sessions, ancestry, Runs, lifecycle, Timeline, Interactions, revisions, synchronization, receipts, capabilities, Devices, pairing, revocation, artifact/blob manifests, migrations, backups, and maintenance operations.
- **Pi artifacts** own only Pi-native execution history and state required by the pinned runtime. One version-tagged artifact belongs to each materialized Session. Only the matching worker may read, write, validate, or migrate it.
- **Blob store** owns immutable large payload bytes; SQLite records own their meaning, visibility, order, and ownership.
- **Device storage** owns signing private key, replaceable cache, presentation preferences, and optional drafts.
- **Client memory** owns only Views and pending presentation state.

Pi artifacts and the Timeline overlap as normalized evidence, not mutual backups. The daemon never edits Pi private formats.

### 12.2 Physical stores

SQLite uses WAL and a durability mode that does not acknowledge before required OS flush acceptance. Cross-resource acceptance, ordering, revisions, receipts, revocation, and references are transactional.

Blobs and Pi artifacts use managed directories in the protected Pidex data root. New daemon-managed files are staged, flushed, verified, and atomically renamed before SQLite publishes references. Failed transactions may leave only unreachable files. Startup/background maintenance removes proven orphans after a safety grace period. A database record must never reference a partial file.

Host and CA signing keys use versioned DPAPI-protected envelopes and user-only ACLs. Live Session content is not separately encrypted by Pidex; disk-at-rest protection relies on Windows device encryption or BitLocker.

### 12.3 Run settlement

SQLite and Pi artifacts do not share a transaction. Normal settlement follows this boundary:

1. Worker reaches Pi settlement, durably flushes its artifact, and returns stable checkpoint evidence.
2. Required immutable Timeline payloads are staged, flushed, verified, and published.
3. One SQLite transaction verifies expected executing Run and checkpoint, commits normalized Timeline and blob references, records checkpoint evidence and terminal outcome, and advances revisions and synchronization.
4. Only after commit may the Host report Completed, Failed, or Cancelled.

A crash between stages triggers reconciliation. The Host may complete recording only from proof and never replays a Run to discover its result.

### 12.4 Retention and maintenance

V1 automatically deletes no authoritative product or security history. Available and archived Sessions retain identities, complete reachable Timelines, blobs, required Pi artifacts, and ancestry indefinitely. Device records and revocation tombstones are also indefinite.

Operational retention minimums are:

- Command receipt proof: 30 days after terminal outcome;
- resumable synchronization changes: 7 days;
- scheduled online recovery snapshots: 7 changed-day recovery points; and
- diagnostics/crash artifacts: bounded to 1 GB under default policy.

Expired pairing verifiers, temporary/staging files, superseded derived indexes, disposable caches, and bounded diagnostics may be removed by explicit maintenance rules. Blobs and artifact generations may be collected only after proving them unreachable from every retained Session, Fork, active generation, protected rollback, and retained backup manifest. Uncertainty retains bytes.

### 12.5 Upgrade and migration

Before data-changing upgrades, the daemon preflights compatibility, integrity, and free space; creates a protected recovery snapshot; stops mutations and workers; migrates into a new versioned data generation; validates it; and activates atomically. Failure leaves the prior generation runnable by the prior release.

Pi artifacts are copy-migrated lazily when a Session first wakes under the new release. The original remains protected until a new worker verifies a stable checkpoint. A failed artifact migration isolates that Session while its Host Timeline stays readable.

## 13. Backup, storage protection, and recovery

### 13.1 Online recovery snapshots

Local online recovery snapshots are enabled automatically. The Host creates at most one scheduled snapshot in each changed 24-hour period, skips unchanged days, creates protected snapshots before upgrade/migration risk boundaries, and accepts manual requests. A due changed-day snapshot begins within two hours after a healthy Host is available, with scheduling jitter no greater than 30 minutes.

Snapshots capture a named synchronization barrier, SQLite snapshot, referenced immutable blobs, and each Session's last verified Pi checkpoint. They may run during execution but do not claim unverified tails. A Run executing at the barrier restores as Interrupted unless later settlement proof is included.

Snapshot bytes live in a separate managed recovery store and must not rely on hard links or live-store files as their only copy. Content-addressed deduplication is allowed after verification.

Retention is seven rolling changed-day points. Supported rollback-boundary points remain protected. Manual points remain until explicit deletion. Underlying bytes are reclaimed only after all retained snapshot and rollback manifests prove them unreachable.

### 13.2 Portable backups

Portable backup is manual and optional. Pidex does not schedule it, retain its passphrase, or warn persistently about its absence or age.

Starting one creates a durable Host maintenance operation, stops new product mutations, and drains accepted work for up to 15 minutes. It never pauses work or offers a force path. Timeout or failure aborts, cleans or quarantines staging, and resumes normal acceptance. The user must separately settle or Stop blockers before retrying. Client disconnection does not cancel an accepted operation; another authenticated Client may observe or cancel it. Daemon loss interrupts it and discards the volatile passphrase without replay.

At quiescence, Pidex creates one authenticated passphrase-encrypted bundle containing:

- coherent database;
- all referenced blobs and Pi artifacts;
- portable Host identity and private-CA material;
- synchronization barrier;
- schema, backup, Pidex, and pinned-runtime compatibility inventory; and
- complete hash manifest.

The bundle contains no executables. Pidex closes, rereads, decrypts, and fully verifies staging before declaring it ready. Export supports resumable hash-checked PWA download and CLI copy to Host-visible destinations.

The UI distinguishes **Bundle verified**, **Delivered and stream-verified**, and **Destination verified**. Browser download alone cannot claim destination verification. Exported files are user-owned and never auto-deleted. The Host retains only a non-secret catalog record after staging expires.

### 13.3 Integrity and orphan handling

Snapshot creation verifies database consistency, manifest/reference closure, new or changed objects, and evidence for unchanged objects. Every portable backup creation and every restore performs full end-to-end verification.

Low-priority background scrubbing covers the live database, immutable stores, Pi checkpoints, recovery store, snapshot manifests, and backup catalog, with complete online retained-byte coverage within a monthly window subject to foreground load and health.

Pidex may automatically repair a damaged immutable object only from an independently verified byte-identical copy with proven provenance and cryptographic identity. It quarantines damage, verifies replacement, activates atomically, and records evidence. Unprovable damage isolates the smallest affected scope. Global SQLite, Host identity, or authority-invariant damage enters recovery mode rather than rolling back silently.

Orphan deletion is two-pass: prove unreachable against stable authority and all protected manifests, quarantine/tombstone for a type-specific grace period, then independently prove it remains unreachable before deletion. Uncertainty retains or restores it. Cleanup must not follow reparse points outside managed roots.

### 13.4 Storage protection

Pidex reserves emergency headroom for SQLite/WAL, accepted-Run settlement, cancellation evidence, Device revocation, maintenance bookkeeping, and recovery diagnostics. Admission control starts before reserve consumption.

Automatic pressure cleanup may remove only proven disposable data: abandoned staging, verified orphans, expired diagnostics/caches, unsupported rollback generations, and unprotected snapshots outside retention. It must not delete authoritative Sessions, Timelines, blobs, required Pi artifacts, receipt/synchronization minima, protected rollbacks, or manual snapshots.

If safe cleanup cannot restore reserve, the Host enters storage-protection mode. It rejects discretionary growth including new Runs, Forks, uploads, and pairing while preserving reads and minimum writes for accepted settlement, Stop/cancel, revocation, cleanup, possible export/backup, and diagnostics.

### 13.5 Recovery mode and restore

Normal PWA navigation includes a Recovery page for snapshot age/retention, protected points, portable catalog and verification, operations, scrub coverage/findings, recovery usage, storage pressure, and create/export/verify/delete/restore actions. Backup age does not create a global banner; contextual rejection links to Recovery.

Global database, Host-key, or authority-invariant failure disables LAN product service and mDNS. Recovery mode is available only through the signed CLI and localhost page opened with a short-lived single-use launch capability. Paired Devices are not trusted while global authorization is uncertain. Isolated Session artifact/blob faults stay scoped in normal operation where authority remains sound.

While normal authority is valid, any paired Device may initiate whole-Host restore through a revision-preconditioned explicitly confirmed command. In recovery mode, restore is Host-local only.

Restore is whole-Host replacement, never merge, clone, selective import, or automatic rollback. It:

1. fully verifies source, encryption, identity, manifest, reference closure, and compatibility;
2. tests local candidates newest-first and presents the newest verified compatible point;
3. discloses skipped points, rollback range, affected Runs/Devices, identity/origin, migration, and revocation rollback risk;
4. requires explicit Restore, with stronger confirmation for older or identity-changing paths;
5. materializes and migrates a new generation while stopped;
6. verifies and atomically activates it;
7. preserves the replaced generation for explicit cleanup; and
8. rotates synchronization epoch so all Clients reset.

Failure before the new generation accepts mutations may safely return to the prior generation. After mutation acceptance, another managed restore is required.

Online snapshots require the same Windows identity or equivalent DPAPI recovery environment. Portable backups transfer original Host identity and CA. Preflight detects a likely live identity/origin collision and requires confirmation that the original Host is retired.

Device authorization restores exactly as captured. A Device revoked after the recovery point may therefore become Paired again; preview must identify and explain this risk.

Captured executing/cancelling Runs become Interrupted, worker Interactions become withdrawn, and queued Runs enter explicit recovery hold. Nothing resumes automatically or replays post-barrier intent.

### 13.6 Reidentify and evidence export

When product data fully verifies but Host trust keys are unrecoverable and no portable identity backup exists, localhost recovery supports explicit Reidentify. It first creates the strongest verified encrypted export still possible, then creates new Host identity, origin, private CA, and synchronization epoch around the verified product data. Every Device authorization becomes invalid and all Devices must pair again. The loss of cryptographic continuity is recorded explicitly.

If global authority cannot verify, Pidex may export an encrypted evidence package but must label it non-restorable. It must not salvage rows, guess relationships, omit damage silently, or use last-write-wins repair.

## 14. Windows Host operations

### 14.1 Install and startup

V1 is a signed per-user Windows 11 x64 installation under local application data. It bundles required runtimes and does not depend on system Node. It runs unelevated as the signed-in user, is not a Windows service, and does not survive user logout.

The installer registers a per-user Task Scheduler logon task for the stable signed launcher. The launcher enforces one instance, selects a versioned release, performs readiness handshake, and supervises failures. Each start has a 15-second readiness deadline. Failures retry at most five times with 1, 2, 4, 8, and 16-second backoff, then open a circuit breaker. LAN service and workers remain down while CLI and localhost recovery expose retry and safe rollback.

A narrowly scoped signed helper elevates only for creating, inspecting, repairing, and removing fixed-schema Pidex Firewall rules.

Startup opens local control first, validates release compatibility, durable state, certificates, port, and firewall, then advertises readiness and mDNS. Without usable network, Host-local administration and durable reads remain available while LAN readiness reports failure.

### 14.2 Local control and diagnostics

The signed `pidex` CLI supports status, start, stop, restart, pairing, Device revocation, origin/certificate/firewall inspection and repair, updates, logs, health diagnosis, support bundles, backup, restore, and recovery.

The CLI may open localhost setup/recovery with a short-lived single-use launch capability. Ordinary web origins must not invoke localhost mutations through ambient access.

Structured logs and crash artifacts rotate within a 1 GB default bound. Windows Event Log receives coarse lifecycle/failure events only. `pidex doctor` checks launcher/daemon versions, crash loop, database/migrations, certificates, origin resolution, port ownership, firewall/profile, mDNS, update staging, workers/Jobs, and storage.

Support bundles redact secrets, prompts, conversation content, tool payload/output, and sensitive paths by default. Adding content requires explicit export choice. V1 sends no automatic telemetry, logs, or crash reports.

### 14.3 Updates and rollback

Pidex verifies release metadata and complete packages against a pinned signing root, stages immutable versioned releases, and never executes partial/unverified downloads. Clients may defer ready updates.

Activation requires Host-wide quiescence: no executing, queued, held, or cancelling Run; no unresolved Interaction; and no incomplete lifecycle work. The launcher stops mutation acceptance, flushes, stops workers, activates release, starts matching daemon/worker generation, and waits for readiness before committing the active pointer. Update force applies explicit Stop semantics first. Mixed daemon/worker generations and worker hot-swap are forbidden.

Before the new release accepts mutations, failed activation rolls back release pointer and data generation. After acceptance, rollback requires supported reverse migration or managed restore. Launcher replacement uses an installer-grade two-phase helper and never overwrites a running executable.

### 14.4 Process supervision and shutdown

The launcher owns a kill-on-close daemon Job and the daemon owns nested non-breakaway Session Jobs. Loss of supervision tears down the contained trees.

Normal stop, restart, update, uninstall, and portable backup drain for at most 15 minutes, then abort and resume acceptance. Force must be explicit and durably accept Stop before Job termination.

Windows shutdown/logoff gets a 10-second bounded flush and cooperative-abort budget. Job closure then terminates the remainder. Unproved executing outcomes reconcile as Interrupted, not Cancelled.

### 14.5 Uninstall and portability

Normal uninstall removes Task Scheduler registration, firewall rules, Current User root trust, binaries, staged releases, and disposable caches but preserves durable data, Host identity, CA material, state, artifacts, and managed backups. Destructive purge is a separate strongly confirmed action. Uninstall obeys drain-versus-force semantics.

Portable daemon code depends on a versioned Host-platform operations interface. Platform-neutral domain, protocol, lifecycle, update, diagnostic, discovery, and supervision contracts must not depend directly on Windows APIs.

## 15. Extension and workspace seams

Future workspace tooling extends the Host beside Sessions. A Session may target another Host-owned object but never owns its identity, persistence, supervision, or lifetime.

### 15.1 Identity and granularity

Only objects with independent Pidex-owned lifecycle or durable state become cataloged resources. A Git worktree is a Workspace. Files, directories, Git refs, commits, diffs, and ad hoc commands are typed revision-preconditioned Workspace targets, not automatically durable aggregates. Terminals, managed processes, and configured tunnels gain Host IDs only when Pidex owns lifecycle or configuration.

Each resource kind declares valid scope and relationships. The kernel rejects invalid cross-Project/Workspace references before module dispatch.

### 15.2 Protocol and storage

Modules register namespaced versioned families of commands, results, snapshots, projection changes, events, capabilities, and worker service requests before readiness. All use the kernel envelope; opaque bypass channels are forbidden.

Worker-to-Host feature requests are correlated, capability-negotiated, and validated. Only the daemon may accept them durably, invoke a module, and publish authority. Workers never write module stores or Client projections directly.

Modules own namespaced SQLite tables/indexes and registered blob kinds and provide deterministic migrations, integrity checks, backup enumeration, restore validation, retention hooks, and reference discovery. They must not create private authoritative databases or hide structured authority in generic key-value data.

Missing/incompatible modules preserve IDs, schemas, provenance, and bytes; mark affected kinds unavailable; and block affected commands. Unrelated Host and Session functions remain available unless a global invariant is damaged.

### 15.3 Lifecycle and UI contributions

A long-lived Terminal or Managed Process starts through an explicit Host command in a separate contained Job under its own module lifecycle. Session/Run may be provenance only. Session cancellation, sleep, archive, replacement, or Client loss does not implicitly own that resource.

The Client shell exposes semantic contribution slots for resource destinations/detail sections, commands/context actions, status/diagnostics, Timeline renderers, and Interaction renderers. Contributions declare identity, module, capability, projection types, compatibility, and placement semantics. The shell owns responsive placement and lifecycle-independent Views. Renderers mutate authority only through normal commands.

V1 runs bundled trusted modules only. Manifests reserve module identity/version, Host compatibility, protocol families, resource kinds, migrations, capabilities, diagnostics, lifecycle services, and UI contributions. Registration is deterministic and collision-failing. Boundaries must permit a later supervised extension host without changing identity, storage, or Client protocol.

Electron later acts as another Device/Client shell over the same contracts. A tunnel later acts as a transport adapter and cannot become domain authority or weaken authentication.

## 16. Cross-cutting invariants

The implementation and its tests must preserve all of these invariants:

1. Host authority has exactly one durable owner per fact.
2. An acknowledged Run or command never disappears.
3. Every accepted Run has exactly one terminal outcome.
4. No uncertain mutation is replayed merely to discover whether it committed.
5. Device/Client projections become authoritative only by snapshot or Change Set.
6. A Client claiming `current` equals Host projection for its synchronized scopes.
7. View, connection, Device, Session residency, Session retention, and Run execution lifecycles do not own one another implicitly.
8. Races are resolved by exact target identity, revision, state preconditions, and Host commit order; intent is never silently retargeted.
9. Unknown required semantics fail closed at the smallest valid scope.
10. Worker/process failure is isolated to the smallest affected Session unless a global authority invariant is damaged.
11. Cancellation and recovery do not promise side-effect rollback.
12. Restore, migration, and update do not silently roll authority backward.
13. Revocation stops future authority but does not claim remote cache erasure.
14. Offline and Push data never claim current Host state.
15. Authentication protects every product surface even on a trusted LAN.
16. One Host-global Session read-through position advances monotonically only through an exact visibly presented authoritative tail.
17. Timeline and Session read authority move together across persistence, backup, restore, and Authority-generation selection.

## 17. Quality and release acceptance

### 17.1 Evidence policy

Every required criterion is a hard gate. A waiver is allowed only for a documented external browser/OS defect with a safe fallback and no weakened correctness, security, authority, integrity, or recovery guarantee.

Evidence records exact build, environment, configuration, and artifacts. Later code, dependency, schema, installer, configuration, or signing changes receive impact analysis and rerun affected gates. Blocking tests are deterministic; retries gather diagnostics but do not erase failure. Quarantined/flaky tests provide no evidence.

### 17.2 Supported environment and scale

Host floor: supported Windows 11 x64, SSD, at least four hardware threads, 8 GB RAM, and 10 GB free at install/test start. Interactive network baseline: at most 50 ms RTT and 1% packet loss.

Blocking browsers are current and previous major versions at release time of:

- Edge and Chrome on supported Windows;
- Chrome on supported Android; and
- Safari browser and installed standalone PWA on supported iOS/iPadOS.

Firefox and others are best effort. Unsupported/incompatible browsers fail clearly without partial-current control.

All tiers test 10,000 retained Sessions, one 100,000-entry Timeline, and six Clients across three Devices. The 8 GB tier supports four resident Sessions and two executing Runs; the 16 GB tier supports eight resident Sessions and four executing Runs. These are floors, not caps. Above them, measured admission preserves OS headroom and reports pressure.

### 17.3 Performance and resources

Under the supported tier/network baseline, end-to-end p95 must meet:

- cold usable shell: 3 seconds; warm: 1 second;
- cached Session switch: 300 ms; uncached recent Session: 2 seconds;
- Host command outcome: 250 ms; authoritative projection reconciliation: 500 ms;
- live output after Host receipt: 250 ms;
- resumable reconnect to current: 3 seconds;
- sleeping worker ready: 5 seconds; and
- normal daemon ready: 15 seconds.

Provider latency, tool execution, user media, Push delivery, and backup destination I/O are excluded and shown distinctly.

Resource gates:

- quiescent launcher + daemon: at most 300 MB RSS and 1% average CPU;
- each quiescent resident worker: at most 300 MB RSS;
- Client with 100,000-entry Timeline: at most 300 MB JS heap;
- default rotating diagnostics/crash data: at most 1 GB; and
- after 72-hour soak returns to equivalent quiescence: no monotonic handle growth and at most 10% memory growth.

### 17.4 Correctness, security, and fault evidence

Every release runs a blocking contract suite against the exact bundled Pi SDK using deterministic fake models, tools, extensions, Interactions, cancellation, retries, compaction, malformed messages, loss, and capability combinations. Required semantic or schema drift blocks readiness and release. Real-provider smoke tests are advisory.

Across tests there may be no lost, duplicated, reordered, silently replayed, or outcome-less accepted Command, Run, steering, follow-up, Interaction Response, cancellation, Timeline settlement, or maintenance operation.

Reliability evidence includes:

1. deterministic injection at every acceptance, dispatch, checkpoint, settlement, snapshot, migration, activation, and restore boundary;
2. a 72-hour soak with zero invariant, crash, stuck-work, convergence, queue-growth, or resource violations; and
3. the seven-day daily-driver trial.

The fault matrix covers uncooperative process trees; worker/daemon/launcher loss; reboot/power loss; network drop/duplicate/reorder/delay/backpressure; revocation races; wall-clock jumps; disk full, permission, partial writes, and corruption; certificate rotation/expiry; firewall drift; update/migration failure; interrupted backup/restore; and corrupt newest recovery point.

Security automation maps applicable controls to OWASP ASVS Level 2 and covers secret/dependency/vulnerability scanning, static analysis, protocol/schema fuzzing, TLS/origin, pairing limits, challenge authentication/revocation, authorization, CSRF/cross-origin defense, localhost launch capabilities, privileged helper schemas, signed updates, backup encryption, IPC validation, and redaction. Every artifact is signed and has an artifact-linked SBOM. No known critical/high vulnerability ships; medium requires documented acceptance and compensating controls.

### 17.5 Recovery, accessibility, and observability boundaries

Recovery gates include clean online restore, interrupted restore, corrupt-newest fallback, failed-migration rollback, identity-preserving portable restore, Reidentify, storage pressure, and corruption drills. They verify progress or typed failure, generation preservation, epoch rotation, and no silent rollback, merge, replay, or unverified-byte claim.

V1 intentionally has no fixed restore-time objective, snapshot completion deadline, portable-verification deadline, or recovery-mode-entry deadline. Outcomes and visible progress are gated instead.

V1 makes no WCAG conformance claim and has no blocking accessibility or assistive-technology matrix. Accessibility blocks only when it independently breaks another required workflow/browser criterion.

Observability requires typed actionable startup/health failures, bounded structured logs/crash artifacts, redaction automation, `pidex doctor`, CLI, diagnostics, and Recovery behavior. V1 adds no blocking telemetry, metrics system, distributed tracing, or formal operator drill beyond fault-test visible outcomes.

### 17.6 Promotion and defects

Promotion exercises clean install, supported-version upgrades, pre-acceptance rollback, uninstall/reinstall with data preservation, browser/capacity matrix, security automation, Pi contracts, fault/recovery suites, soak, and daily-driver trial.

No Severity 1 or 2 defect ships. Severity 1 includes authority loss/duplication/corruption, unauthorized control/secret exposure, unsafe update/restore, or Host-wide unrecoverability. Severity 2 includes unavailable core workflow, falsely current Client, broken isolation, repeatable daemon/Client crash, or failure on a required browser/capacity tier. Severity 3 requires safe workaround, bounded scope, owner, and follow-up. Any hard-gate failure blocks regardless of severity.

## 18. Decision audit and implementation-planning handoff

### 18.1 Contradictions

No unresolved contradiction remains.

One deliberate revision was found and normalized in this specification: [Define Windows daemon operations](issues/09-define-windows-daemon-operations.md) supersedes the earlier Private-network enforcement posture in [Set the LAN trust boundary](issues/06-set-lan-trust-boundary.md). Final v1 behavior is wildcard HTTPS plus Private-profile Windows Firewall rules, with prominent warnings but continued LAN service when enforcement is missing or unverifiable. Authentication, canonical-origin, TLS, and mDNS restrictions remain unchanged.

The other apparent tensions are intentional separations, not conflicts:

- worker isolation is a reliability boundary while the whole Host remains trusted;
- Host command deduplication is at-most-once while external tool side effects are not transactional;
- Session Timeline and Pi artifacts overlap as projections/evidence but own different facts;
- Device revocation stops future authority but cannot erase copied offline data;
- a planned force produces Cancelled while unexpected loss produces Interrupted when completion is unproved; and
- restore preserves captured Device authorization even when that rolls back a later revocation, with mandatory disclosure.

### 18.2 Unresolved product or architecture requirements

None. All destination-level product, domain, authority, lifecycle, consistency, security, UX, persistence, operations, extension-seam, recovery, and release-gate decisions required before implementation planning are resolved.

No further wayfinding ticket is required before implementation planning begins.

### 18.3 Parameters to choose during implementation planning

The following are deliberately implementation parameters, not unresolved product or architecture decisions. Plans may choose them through measurement, standard security practice, compatibility probing, or reversible configuration, while preserving every normative invariant and hard gate above:

- concrete implementation stack for daemon/kernel/PWA and internal package boundaries, except for the required Node Pi worker and SQLite authority store;
- exact canonical high port, install/data paths, schema names, message encoding, cryptographic algorithms/key sizes, and backup container/KDF satisfying the security gates;
- idle-worker sleep policy and resource-admission heuristics above tested capacity floors;
- bounded WebSocket queue sizes, snapshot recent-window size, Timeline page size, output coalescing, payload/string limits, and heartbeat transport mechanics consistent with fixed suspect/disconnect deadlines;
- default Device cache budget, warning thresholds, cleanup latency, and application eviction batch sizes;
- exact emergency byte reserve, storage-pressure thresholds, staging expiry, orphan grace periods, scrub throughput, and maintenance scheduling consistent with retention and monthly coverage requirements;
- visual tokens and responsive details within the approved information architecture and prototype;
- exact diagnostics, log, and crash-artifact rotation sizes within the 1 GB aggregate gate; and
- test harness, failure-injection tooling, benchmark datasets, and evidence storage used to prove the release gates.

These parameters must be recorded in implementation plans or executable configuration and tested. Choosing them does not reopen this product and architecture map unless a plan proposes to weaken or change a normative decision.

### 18.4 Planning entry condition

Implementation planning may begin when it treats this specification and the canonical glossary as input, preserves the authority and failure boundaries, traces planned work to the release gates, and records the parameter choices above. The wayfinding destination is reached.
