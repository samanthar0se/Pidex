Type: grilling
Status: resolved
Assignee: pi
Blocked by: 04, 05, 06

## Question

Which state belongs to Pi session files, daemon persistence, content blobs, or individual clients—including Host and Device identities, pairing and revocation records, and private-CA material—and what durability, migration, retention, backup, and corruption-recovery guarantees apply?

## Comments

This decision was resolved through a live grilling session. It introduces no new domain term: the storage names below are implementation boundaries, while the existing Host, Session, Run, Session Timeline, Device, Client, and View language remains authoritative.

## Answer

### Single-authority ownership

Every durable fact has one authority. Copies in another store are references, projections, caches, or recovery evidence; Pidex never resolves disagreement by timestamp or last-write-wins.

- The daemon store is authoritative for the Pidex domain: Host identity metadata, Projects, Workspaces, Sessions, Fork ancestry, Runs, lifecycle state, the Session Timeline, interactions, revisions, synchronization epochs and cursors, command receipts, capabilities, Device public keys and authorization state, pairing and revocation records, artifact and blob manifests, and migration and backup metadata.
- One version-tagged Pi session artifact belongs to each materialized Session and is authoritative only for Pi-native execution history and state required to resume or fork through the pinned Pi runtime. A Session may exist before this artifact does. Only a worker running the appropriate Pidex-pinned Pi version may read, write, validate, or migrate it; the daemon never synthesizes or independently edits Pi's private format.
- The blob store owns immutable large payload bytes referenced by daemon records, such as consolidated output bodies or other schema-defined Timeline content. A content hash identifies and verifies a blob, but the daemon record remains authoritative for its meaning, visibility, order, and ownership.
- A Device owns its non-extractable signing private key, replaceable offline cache, device-specific presentation preferences, and optionally reload-surviving unsent drafts. A Client owns only ephemeral Views, navigation, scroll and selection state, and pending-intent overlays. None of this local state can mutate Host authority without an accepted command. Anything intended to synchronize across Devices must become an explicit Host-owned domain feature.

Pi artifacts and daemon Timeline data deliberately overlap only as normalized evidence. The Pi artifact preserves what the pinned runtime needs; the daemon Timeline preserves the stable product contract Clients need. Neither store is a generic backup of the other, and inability to reconstruct a private Pi artifact from the Timeline is not treated as a daemon-data defect.

### Physical stores and secret custody

Daemon-owned transactional state lives in one SQLite database using WAL and a durability configuration that does not acknowledge commits before the operating system has accepted the required flushes. SQLite transactions enforce cross-resource acceptance, ordering, revisions, receipts, Device revocation, and reference updates. Subject to the Host hardware and Windows storage guarantees, an acknowledged daemon commit survives process or Host loss.

Immutable blobs and versioned Pi artifacts live under separate managed directories in the same protected Pidex data root. New blobs and daemon-managed artifact copies are written to staging, flushed, verified, and atomically renamed before a SQLite transaction may publish their references. A failed transaction can leave only unreachable files; startup and background maintenance remove verified orphans after a safety grace period. A database record may never point at a partially published file.

Device public keys, authorization states, pairing-verifier digests and expiries, revocation tombstones, public certificates, and non-secret Host identity metadata live in SQLite. The Host identity signing key and private-CA signing key live in versioned encrypted envelopes protected by a platform secret-protector abstraction. Windows v1 uses DPAPI scoped to the daemon's Windows user plus user-only filesystem ACLs. One-time pairing secrets are never persisted in plaintext.

Live Session content in SQLite, blobs, and Pi artifacts is not separately encrypted by Pidex v1. The data root is restricted to the daemon's Windows user, and disk-at-rest protection relies on Windows device encryption or BitLocker. This matches the decision to trust the signed-in user and Host filesystem while avoiding a second content key whose loss could make recovery impossible.

### Acceptance and settlement durability

A command or Run is accepted only after its validation result, identity, ordering, preconditions, receipt, and authoritative state transition commit in SQLite. Worker dispatch occurs after that commit, so an acknowledged Run cannot disappear even if the worker never starts.

SQLite and a Pi artifact do not pretend to share one atomic transaction. Normal Run settlement uses this ordered boundary:

1. The pinned worker reaches Pi settlement, durably flushes its session artifact, and returns stable checkpoint evidence identifying the artifact version and settled position.
2. Any immutable Timeline payloads are staged, flushed, verified, and published in the blob store.
3. One SQLite transaction verifies the expected executing Run and checkpoint, records normalized Timeline entries and blob references, records the checkpoint evidence, sets the terminal outcome, and advances revisions and synchronization state.
4. Only after that transaction commits may Pidex report the Run as completed, failed, or cancelled to Clients.

A crash between these stages is an explicit reconciliation case. The daemon compares its durable acceptance record with the artifact through the pinned worker and may finish recording a result only when the evidence proves it. It never replays the Run to discover what happened. Unproven normal settlement follows the previously defined interrupted-Run semantics.

### Retention and compaction

Pidex v1 performs no automatic deletion of authoritative product or security history. Available and Archived Sessions retain their identities, complete reachable Timelines, referenced blobs, required Pi artifacts, and Fork ancestry indefinitely. Device records and non-secret revocation tombstones are also retained indefinitely. Archival is not a storage-expiry policy.

Operational records have bounded roles:

- Command receipts and their advertised validity contexts remain provable for at least 30 days after their terminal command outcome. After compaction, reuse of an old Command ID is expired or indeterminate and can never execute as new intent.
- Resumable synchronization changes remain available for at least 7 days. An older cursor receives an authoritative scope reset; the Session Timeline itself is unaffected.
- Expired pairing verifiers, temporary files, abandoned staging files, superseded derived indexes, and bounded diagnostics may be removed under explicit maintenance rules.
- Blobs and artifact generations may be garbage-collected only after the daemon proves they are unreachable from every retained Session, Fork, current generation, protected migration rollback, and retained backup manifest. Reference uncertainty fails closed and retains the bytes.

Storage pressure may stop new mutations with a diagnostic; it may not violate these minimum windows or silently delete authoritative data. Exact reservations, warnings, quotas, and maintenance schedules belong to the operational and quality decisions.

### Backup and restore

Pidex exposes managed backups rather than claiming that a raw copy of the live data directory is coherent.

An online recovery snapshot captures a SQLite snapshot at a named synchronization barrier, every referenced immutable blob, and each Session's last verified Pi checkpoint. It may run while a Run is executing, but it does not claim the unverified execution tail: a Run that is executing at the captured barrier restores as interrupted unless the snapshot contains later proof of settlement. Host and CA key envelopes remain DPAPI-bound, so this snapshot is intended for recovery under the same Windows identity or equivalent DPAPI recovery environment.

A portable backup first stops new mutations and reaches quiescence by draining accepted work or applying explicit normal Stop semantics. It then bundles the database, all referenced blobs and Pi artifacts, schema and pinned-runtime versions, the synchronization barrier, and a hash manifest. The entire bundle, including a portable Host identity and private-CA export, is authenticated and encrypted with a user-supplied passphrase. Pidex never places an unencrypted portable private-key export in the backup directory.

V1 restore is whole-Host replacement, not merge or selective import. With the daemon stopped, restore verifies the bundle before writing, materializes a new data generation, runs supported migrations, verifies the result, and atomically activates it while preserving the damaged or replaced generation for explicit cleanup. Supplying the portable identity preserves the backed-up Host identity; omitting usable identity material cannot silently create an equivalent Host. Every restore and any other possible rollback rotates the synchronization epoch so Clients reset rather than accepting reversed cursors. Canonical-origin changes retain the previously decided reinstallation and re-pairing consequences.

Backup cadence, destinations, rotation, storage-pressure UX, restore administration, and measurable recovery objectives are delegated to [Define backup and data recovery operations](15-define-backup-and-data-recovery-operations.md) and the Windows operations and quality tickets.

### Upgrade and migration

Upgrades are managed and fail closed. Before changing data, the daemon preflights compatibility, integrity, and free space; creates an automatic recovery snapshot; stops mutations and workers; migrates SQLite transactionally into a new versioned data generation; and activates that generation only after validation. A failed migration leaves the prior generation runnable by the prior release.

Pi artifacts are not bulk-rewritten or migrated in place. They retain their source Pidex and pinned-Pi version metadata and are copy-migrated lazily when a Session first wakes under the new release. Migration runs through the new pinned worker boundary, and the original artifact remains protected until the copy reaches and verifies a stable checkpoint. Failure isolates that Session and leaves its Timeline readable rather than failing or corrupting every Session.

In-place downgrade is unsupported. Rollback means running the prior release against the preserved pre-upgrade generation or restoring its recovery snapshot. Migration chains and release support windows must be explicit; an unsupported source version fails before mutation rather than attempting a best-effort conversion.

### Corruption recovery

Integrity failures preserve evidence, fail closed for authority-bearing mutations, and isolate the smallest scope that can remain safe:

- Corrupt SQLite, inconsistent global invariants, or unreadable Host identity keys puts the daemon into Host recovery mode. Authenticated diagnostics and verified export may remain available where safe, but product mutations do not. Pidex preserves the damaged generation and requires explicit restore or a separately designed identity reset; it never silently rolls the Host backward.
- A missing or corrupt blob marks the referenced content unavailable with a durable diagnostic. Unaffected metadata and Sessions remain readable. Pidex may recover identical bytes from a verified backup or authoritative Pi artifact when provenance and hash prove equality, but it never substitutes approximate content.
- A corrupt Pi artifact isolates that Session's execution. Its daemon-owned Timeline remains readable, but wake, resume, or Fork operations requiring unavailable Pi state stop at the last verified checkpoint. Recovery uses a preserved artifact generation or verified backup; the daemon does not manufacture a replacement from its projection.
- Derived indexes, cached snapshots, and other explicitly rebuildable projections may be discarded and rebuilt from their named authority. Rebuilding a projection never changes domain revisions or fabricates missing authoritative facts.

Every repair or restore emits diagnostics describing the affected scope, lost or unavailable range, source used, integrity evidence, and resulting synchronization-epoch change. Automatic salvage, silent record deletion, and last-write-wins repair are forbidden.
