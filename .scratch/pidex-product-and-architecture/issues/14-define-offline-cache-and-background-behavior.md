Type: grilling
Status: resolved
Assignee: pi
Blocked by: 05, 06

## Question

What Session data may a Device cache for read-only offline access, how must Clients represent staleness and reconnect reconciliation, and what service-worker, mobile-background, notification, command-queuing, credential-revocation, and cache-cleanup guarantees apply?

## Comments

This decision was resolved through a live grilling session. Browser service-worker lifecycle, Background Sync availability, storage eviction, and Web Push constraints were checked against MDN, web.dev, and Apple documentation. The result introduces no new domain term: offline data remains a replaceable Device cache of Host-owned projections, while a service worker is only a browser execution mechanism.

## Answer

### Cache scope and authority

A paired Device keeps a bounded, demand-filled offline working set rather than a proactive mirror of the Host. It may retain:

- the complete versioned application shell and offline navigation fallback;
- the last atomically synchronized Host, Project, Workspace, Session, Run, and Interaction summaries needed for discovery and supervision;
- synchronized detailed projections for Sessions the Device has opened, including the last observed mutable Timeline tail; and
- finalized Timeline pages and immutable content blobs the Device actually fetched.

Every cached domain record carries its Host identity, synchronization epoch and cursor, protocol and cache-schema basis, scope identity, resource revisions where applicable, and last successful Host synchronization time. The cache is a non-authoritative projection and may be incomplete or evicted. A cached live Timeline entry is explicitly the last observed incomplete revision, not a finalized record. Pidex never infers that an absent cached item is absent from the Host.

The cache must not contain plaintext free-form input or editor Interaction Responses, matching [Define the human interaction and approval model](13-define-human-interaction-and-approval-model.md). It may contain other content already exposed through the Session Timeline, including source code, paths, prompts, model output, tool activity, and extension notification text; Pidex cannot reliably classify secrets embedded in that content. Pairing and offline-storage UX must therefore state that a Device can retain sensitive coding data.

Structured domain projections live in an explicit, per-Host IndexedDB store and are installed or advanced transactionally under the same snapshot and Change Set rules as the live projection. Authenticated HTTP API and Timeline responses use `no-store` and are never treated as authoritative through the browser HTTP cache or an opaque service-worker response cache. Immutable bodies fetched over HTTP enter the offline store only through explicit application logic that verifies their Host-owned metadata and content identity.

V1 adds no application-level content encryption or separate cache-unlock secret. It relies on browser-profile isolation and the Device operating system's at-rest and screen-lock protection. This is a disclosed trust boundary, not a guarantee that a lost, unlocked, compromised, or poorly protected Device keeps cached content confidential.

### Offline and stale presentation

Cached data remains readable while the Host is unreachable. Every affected scope has a persistent, prominent `offline`, `reconnecting`, `current`, `update required`, or `revoked` presentation state and shows when it was last authoritatively synchronized. Session names, last observed Run and Interaction states, mutable output, countdowns, Host warnings, and capability state must never be presented as current merely because they exist in the cache. An offline Interaction countdown is illustrative only; its Host-owned deadline continues independently.

All Host mutations are unavailable until the required Host and target scopes are current under a compatible protocol basis. The Client may continue editing a Device-owned Composer Draft, but it must label the draft as local and unsent. It never changes a send action into a queued Host command.

On reconnect, the Client first verifies the canonical origin, Host identity, Device authorization, and protocol basis. It then resumes from the last committed cursor or installs explicit scope resets exactly as defined by [Design client-daemon consistency](05-design-client-daemon-consistency.md). Cached content may remain visible under its stale or reconnecting treatment during this process, but incoming changes never make a scope look current until the applicable Change Sets or replacement snapshot and cursor commit atomically. An epoch, Host-identity, revision, or schema mismatch resets or discards the affected replaceable projection; cached and Host facts are never merged by timestamp.

### Commands, drafts, and uncertain transport

Pidex creates no offline command queue. Prompts, follow-ups, steering, Stop requests, Interaction responses or dismissals, lifecycle actions, settings, and extension commands require a live authenticated Client with current required scopes and an explicit user action. Reconnection never auto-sends a Composer Draft or intent created while offline.

This does not abandon a command that the Client transmitted while current and whose outcome became uncertain because transport failed. The Device may persist the minimum exact command identity, envelope digest or replay material, and validity context needed to query the Host's durable receipt or retry the identical envelope under its original Command ID. Reconnect may recover that recorded outcome within the advertised receipt window. It may not create a new Command ID, retarget the action, alter its content or preconditions, or execute it after the Host reports the receipt expired or indeterminate.

Composer Draft persistence is independent of Timeline caching and synchronization. A draft is never evicted silently to satisfy the offline-content budget. If the browser cannot durably store or migrate it, the Client warns immediately and keeps the failure visible while the text remains in memory.

### Service worker and application updates

The service worker has a narrow, non-authoritative role: install and serve a content-addressed, versioned application shell; provide the offline navigation fallback; receive Web Push events; route notification clicks; and remove obsolete app-cache generations. It does not own a live connection, run continuous synchronization, decide domain order, accept commands, or transparently cache authenticated API responses. Correctness never depends on the worker remaining resident.

An application update downloads and verifies one complete shell generation before it becomes eligible to activate. A waiting worker notifies open Clients and activates only after an explicit reload or after every older Client closes. Before an accepted reload, each Client attempts to persist its Composer Drafts and other Device-owned state. Pidex does not use immediate activation to mix an old page, new worker, and incompatible IndexedDB or protocol schema.

Cache-schema migration is versioned and atomic. Replaceable domain projections may be discarded and reacquired if migration fails, but signing keys, Device preferences, and Composer Drafts are separate stores and are not silently lost with projection cleanup. If the active Client and Host share no protocol major, the Client enters `update required`, disables control, and activates or obtains a compatible staged shell. Previously readable cache may remain available under stale treatment only if its schema can still be interpreted safely.

### Foreground and mobile background behavior

The Host owns Session execution, so Runs, queues, Interactions, deadlines, workers, and persistence continue without any Client. A visible Client maintains heartbeats, reconnects, and synchronizes under the quality thresholds set later. Once a page is hidden, frozen, suspended, or terminated, Pidex guarantees no continuing WebSocket, output stream, cache refresh, timer, or command delivery. On visibility return or launch, the Client assumes every affected projection may be stale and reconciles before enabling control.

Background Sync, periodic sync, background fetch, and similar browser APIs may be used as optional optimizations only where supported. Their absence, delay, throttling, or termination cannot lose Host work, extend an Interaction deadline, create or deliver a command, or cause a Device cache to be presented as current.

### Notifications and Web Push

Connected Clients surface Pi notifications and Host attention state in-app through the synchronized projection. V1 also supports optional, permission-gated Web Push per Device. Push is best effort: it depends on platform support, PWA installation rules, user permission, browser push services, and internet reachability from both Host and Device. It is not a LAN-only channel and has no delivery deadline or completeness guarantee. In particular, it cannot guarantee that an Interaction is seen before its Host-owned deadline.

The default notification-eligible set is:

- a newly open Interaction;
- every Run terminal outcome;
- queued work held after a failed or interrupted predecessor; and
- Pi warning or error notifications.

Routine output deltas, keyed status or widget changes, title updates, successful synchronization, and ordinary informational activity remain in-app by default. Notification categories and enablement are Device-owned preferences. Host facts still determine event identity and content, allowing each Device and Client to deduplicate in-app and system delivery.

System notifications use rich previews by default. They may include the Host or Session label, event type, and a bounded relevant prompt, Interaction, outcome, or Pi-notification excerpt. They never include an input or editor Interaction Response. Because previews can expose sensitive material on a lock screen, each Device must offer a clear privacy setting that reduces system notifications to generic event text; pairing and permission UX must explain the rich default before enabling push.

A push payload is an encrypted, bounded, versioned event hint with stable event identity, Host identity, event time, and enough preview data to render without treating the service worker as synchronized. A notification states what the Host reported at that event time, not the current state. Clicking it opens the canonical origin and target View, then authenticates and reconciles before showing current status or enabling control. Notification buttons never send prompts, Stop requests, Interaction Responses, dismissals, or other Host commands. Delayed, duplicate, superseded, or already-terminal notifications are harmless and reconcile on open.

### Revocation, forgetting, and cleanup

Revoking a Device atomically stops new push scheduling for it, invalidates its live Clients as already defined, and attempts a final encrypted revocation event when a usable push subscription exists. A Client or service worker that receives an explicit Host-authenticated revocation result enters `revoked` and best-effort deletes the Device signing key, push subscription, Composer Drafts, Device preferences, cached projections, Timeline pages and blobs, and Host-specific app metadata. Re-pairing creates a new Device and a clean cache.

Pidex cannot guarantee remote erasure. A Device that is offline, never runs the origin again, blocks push, or has already copied or backed up browser data may retain and display its existing offline cache until it learns of revocation. Ordinary network failure, certificate failure, Host downtime, or push delay must not be misclassified as revocation and must not destroy valid local data. Product copy must distinguish access revocation from remote wipe.

Each Device has a configurable byte budget for replaceable domain content. Under that budget Pidex evicts least-recently-viewed finalized Timeline pages and blobs first, then older detailed Session projections, while preserving lightweight discovery summaries when practical. Current open Views may be protected from application eviction, but not from browser or operating-system eviction. Pidex requests persistent browser storage where available, monitors estimates and write failures, and still treats browser eviction as permitted behavior rather than a correctness failure.

Obsolete application-shell generations and incompatible disposable schema generations are removed immediately after safe activation or rollback boundaries. Normal cache maintenance is incremental and must not block foreground reconciliation. The Device exposes storage usage, its configured budget, whether persistent storage was granted, and separate controls to clear cached Session data or all local Pidex data. Clearing Session data retains pairing and explicitly retained Composer Drafts; clearing all local data warns that drafts and Device identity will be lost and re-pairing will be required.

Exact default byte budgets, warning thresholds, cleanup latency, foreground reconnect timing, supported browser versions, notification reliability tests, and storage-pressure acceptance cases belong to [Set the quality and acceptance bar](11-set-quality-and-acceptance-bar.md).
