Type: grilling
Status: resolved
Assignee: pi
Blocked by: 03, 04, 06

## Question

How should Pidex install, start, advertise through mDNS, manage its private CA and canonical origin, enforce Private-network binding, update, diagnose, and safely terminate its daemon, Pi subprocesses, and process trees on Windows while remaining portable later?

## Comments

This decision deliberately revises the Private-network enforcement established by [Set the LAN trust boundary](06-set-lan-trust-boundary.md). Pidex still installs Private-profile firewall rules and warns prominently when they are missing or broader than intended, but its HTTPS listener binds wildcard addresses and continues serving when firewall enforcement cannot be verified. The resulting possibility of unintended Public-profile exposure is accepted for v1; authentication and transport requirements do not weaken.

## Answer

### Installation, identity, and startup

Pidex v1 is a signed per-user installation under the installing developer's local application-data scope. It bundles the runtime it needs and does not depend on a separately installed system Node runtime. The normal daemon and its launcher run unelevated with the signed-in developer's profile, filesystem, Pi configuration, credentials, and process authority. Pidex is not a Windows service and does not run before logon or survive that user's logout.

The installer registers a per-user Task Scheduler logon task that starts a small, signed Host launcher from a stable path without a console window. The launcher enforces one Host instance for that Windows user, selects a versioned daemon release, performs a readiness handshake, and supervises unexpected exits with bounded exponential backoff. Repeated startup failure opens a circuit breaker: LAN service and Pi workers remain down while the control CLI and localhost recovery surface expose the failure and explicit retry or safe rollback actions. Exact retry counts, delays, and readiness deadlines belong to [Set the quality and acceptance bar](11-set-quality-and-acceptance-bar.md).

Pidex has no persistent privileged service. A narrowly scoped, separately signed helper requests elevation only to create, inspect, repair, and remove Pidex-owned Windows Firewall rules restricted by default to the Private profile. Every privileged operation validates its fixed schema and Pidex resource names rather than accepting arbitrary commands, paths, ports, or rule definitions from the unelevated daemon.

At startup, the daemon opens local control first, validates release compatibility, durable state, certificates, fixed-port availability, and firewall state, and only then declares product readiness and advertises discovery. With no usable network, Host-local administration and durable read access remain available while LAN readiness reports the blocking condition.

### Canonical origin, certificates, and discovery

One durable, collision-resistant hostname derived from Host identity, such as `pidex-a1b2c3.local`, plus one release-independent fixed high port forms the canonical HTTPS origin. A friendly Host label is presentation metadata, not an alias. Setup checks for an mDNS collision before committing the origin; Pidex never silently renames a committed origin after an update, Windows computer rename, or network change. A true origin change remains the explicit migration already defined by [Set the LAN trust boundary](06-set-lan-trust-boundary.md).

Pidex stores the private CA and leaf private keys in user-only files encrypted with Windows DPAPI and ACLed to the installing user. It installs only the public root certificate into that user's Current User root store. The CA key is loaded only for issuance; leaf certificates renew automatically well before expiry without changing the origin, Host identity, or Device records. Root rotation is explicit and supports an overlap period when the old key remains available. If the root key is lost, the Host-local bootstrap recovery installs the new public root on each Device. Provided Host identity and origin survived, CA rotation preserves paired Device identities and browser-origin state; it is a transport re-trust operation, not re-pairing.

Pidex advertises `_pidex._tcp.local` only on interfaces Windows currently classifies as Private. The minimal record contains the canonical hostname and port, a friendly instance label, a discovery-protocol version, and a short Host-identity fingerprint. It never contains pairing secrets, bootstrap URLs, pairing-open state, project or Session data, runtime state, or Device data. Advertisements follow interface and profile changes; QR and manual canonical URLs remain deterministic fallbacks.

The HTTPS listener binds wildcard addresses, while Pidex-owned firewall rules are the only Private-profile enforcement for TCP service exposure. The daemon continuously inspects those rules and network-profile health. Missing, disabled, or broadened rules produce persistent high-severity warnings in the PWA, CLI, diagnostics page, local logs, and coarse Windows event entries, but do not stop LAN service or existing connections. Thus v1 intends Private-profile exposure by default but does not fail closed against firewall deletion, drift, policy override, or profile misclassification. mDNS remains Private-interface-only even in that degraded state. Authenticated APIs still enforce the one canonical origin, Device authentication, and all previously defined non-anonymous access rules. The temporary HTTP CA-bootstrap endpoint follows the same firewall policy and still serves no credentials, commands, or product data.

### Control and diagnostics

Pidex ships a signed `pidex` control CLI for status, start, stop, restart, pairing, Device revocation, origin and certificate inspection, firewall inspection and repair, update control, log access, health diagnosis, and support-bundle export. The CLI can open a localhost-only setup and recovery page using a short-lived, single-use launch capability; ordinary web origins cannot invoke Host-local mutations through ambient localhost access. A permanently resident tray application is not part of v1.

Diagnostics are local by default. The daemon writes structured, rotating, size-bounded logs and bounded crash artifacts; Windows Event Log receives only coarse lifecycle and failure entries. `pidex doctor` checks launcher and daemon versions, crash-loop state, database and migration state, certificates and expiry, canonical-name resolution, port ownership, firewall rules and network profiles, mDNS publication, update staging, worker/process supervision, and storage health. A support bundle redacts secrets, prompt and conversation content, tool payloads and output, and sensitive paths by default; adding such material requires an explicit export choice. V1 sends no telemetry, logs, or crash reports off the Host automatically.

### Updates and rollback

Pidex checks an authenticated release channel, verifies release metadata and packages against a pinned Pidex signing trust root, and stages complete releases into immutable versioned directories. It never executes a partially downloaded or unverified release. Paired Clients are notified when an update is ready and may defer it.

The launcher applies a staged release only at a Host-wide quiescent boundary: no Session has executing, queued, held, or cancelling Runs, unresolved interactions, or incomplete lifecycle work. It stops mutation acceptance, flushes durable state, stops workers, activates the release atomically, starts one matching daemon and bundled Pi worker protocol generation, and waits for readiness before committing the active-release pointer. A user-requested update-now follows the same drain path. An explicit force applies the established Stop semantics to every affected Session before replacement. Pidex never runs mixed daemon and worker protocol versions or hot-swaps the Pi SDK inside a resident worker.

The launcher can roll back an activation that fails before the new release accepts mutations by restoring both the prior release pointer and the prior versioned data generation guaranteed by [Choose persistence and ownership](08-choose-persistence-and-ownership.md). Once the new release accepts mutations, rollback requires an explicitly supported reverse migration or managed restore; Pidex otherwise fails into recovery rather than starting old code against newer state. Detailed backup restoration remains with [Define backup and data-recovery operations](15-define-backup-and-data-recovery-operations.md). Launcher replacement itself uses an installer-grade two-phase helper so no running executable is overwritten in place.

### Worker and process-tree supervision

Every Session worker is created suspended, assigned to its own non-breakaway Windows Job Object, and resumed only after assignment succeeds. The Job uses kill-on-close and contains every worker descendant, including shells, tools, extensions, grandchildren, and attempted detached processes. No Session-launched process may escape that boundary in v1. A future long-lived development server or similar resource must become an explicitly Host-owned resource with its own lifecycle rather than leaking out of a Session worker.

The launcher also owns a kill-on-close daemon supervision Job, with supported nested-job behavior required by the Windows baseline. If the daemon exits, closes a worker Job, loses supervision integrity, or is terminated, Windows tears down the affected contained trees. Pidex first uses Pi's cooperative abort and normal process settlement; after the bounded grace period it closes or terminates only the affected Session Job. Exact grace periods and resource thresholds belong to [Set the quality and acceptance bar](11-set-quality-and-acceptance-bar.md).

A normal `pidex stop`, restart, or non-forced uninstall enters draining, rejects new mutations, reports remaining work, and waits for a bounded operator-visible period. If it cannot reach quiescence, the operation aborts and the daemon resumes normal acceptance; it never silently escalates to cancellation. The user must explicitly retry with force, which durably accepts Stop semantics for affected Sessions before their Jobs are terminated.

Windows logoff, shutdown, and power loss are not allowed to block indefinitely. On a shutdown notification, Pidex rejects new work, performs bounded flush and cooperative abort work, records every outcome it can prove, and lets Job closure terminate the remainder. On the next start, any executing outcome that cannot be proved is reconciled as Interrupted under [Define session lifecycle and recovery](04-define-session-lifecycle-and-recovery.md), not retroactively labelled Cancelled.

### Uninstall and portability

A normal uninstall removes the Task Scheduler entry, firewall rules, installed Current User root trust, launcher and daemon binaries, staged releases, and disposable caches. It reports and preserves the durable data directory, including Host identity, encrypted CA material, Pidex state, Pi artifacts, and managed backups, so reinstall by the same Windows user can recover the Host. Destructive removal is a separate, explicit purge action with strong confirmation and backup guidance. Uninstall cannot bypass the same drain-versus-force distinction used by stop.

Portable daemon code depends on a versioned Host-platform operations interface rather than directly invoking Windows APIs. The Windows adapter owns autostart registration, privileged firewall operations, DPAPI and certificate trust, network-profile observation, mDNS interface selection, Job Objects, shutdown notifications, coarse OS event reporting, and atomic release activation. Host identity, lifecycle and update policy, diagnostics schemas, discovery semantics, and worker supervision contracts remain platform-neutral, so a later operating-system port replaces adapters and packaging without redefining Pidex's domain or client protocol.
