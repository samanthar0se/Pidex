Type: grilling
Status: resolved
Assignee: pi
Blocked by: 08, 09

## Question

How should Pidex schedule, create, retain, verify, export, restore, and present online recovery snapshots and quiescent portable backups—and how should recovery mode, storage pressure, orphan cleanup, and integrity maintenance operate—without weakening the persistence guarantees?

## Comments

This decision was resolved through a live grilling session. It adds **Reidentify** to [`../CONTEXT.md`](../CONTEXT.md) as the explicit recovery action that replaces unrecoverable Host trust identity without pretending cryptographic continuity.

## Answer

### Default protection and online recovery snapshots

Pidex enables local online recovery snapshots automatically. Portable disaster-recovery backups remain an optional manual operation: their absence or age does not produce a persistent warning or incomplete-setup state.

The Host creates at most one scheduled online snapshot in each changed 24-hour period, creates a protected snapshot before an upgrade, migration, or other named risk boundary, and accepts explicit manual snapshot requests. A scheduled snapshot is skipped when no authoritative state changed. If the Host was unavailable when a changed-day snapshot became due, it creates one after startup validation. Exact scheduling jitter and completion deadlines belong to [Set the quality and acceptance bar](11-set-quality-and-acceptance-bar.md).

Each online snapshot uses the named synchronization barrier and stable Pi checkpoints established by [Choose persistence and ownership](08-choose-persistence-and-ownership.md). It may capture while Runs execute, but it never claims an unverified execution tail. Snapshot bytes live in a separate managed recovery store. Content-addressed objects may be deduplicated across snapshot generations after verification, but a snapshot never hard-links or otherwise reuses a live store file as its only recovery copy. Local snapshots therefore protect against application mistakes and damage to live files, not loss of the disk or Host.

Automatic changed-day snapshots retain seven rolling daily recovery points. A risk-boundary snapshot remains protected while its release or migration rollback is supported. A manual snapshot remains protected until the user explicitly deletes it. Rotation removes only unprotected points outside retention, and underlying recovery objects are reclaimed only after every retained snapshot and rollback manifest proves them unreachable.

### Manual portable backups

Pidex v1 has no unattended portable-backup scheduler or reminder cadence. Every portable backup is started explicitly and prompts for its user-supplied passphrase. The passphrase is never retained for another operation; it exists only in the accepted operation's volatile memory and must not enter durable receipts, logs, diagnostics, or support bundles.

Starting a portable backup creates a Host-owned maintenance operation. The Host stops accepting new product mutations and drains already accepted work toward natural quiescence for a bounded, visible period. Executing and queued work continues rather than pausing. A timeout or failure aborts the attempt, cleans or quarantines partial staging, and always resumes normal acceptance. Backup UI offers no force path: the user must separately settle or Stop blocking work under the established lifecycle semantics before retrying.

Client disconnect does not cancel an accepted backup. Other authenticated Clients may observe or cancel it, and the initiating Client may reconnect to its durable operation status. Daemon loss interrupts the attempt, discards the volatile passphrase, and never replays it automatically.

At quiescence, Pidex builds one authenticated, passphrase-encrypted bundle in Host-managed staging. It contains the coherent database, referenced immutable blobs and Pi artifacts, portable Host identity and private-CA material, synchronization barrier, backup and schema versions, pinned-runtime and compatibility inventory, and a complete hash manifest. It contains data and compatibility metadata, not Pidex executables or restore runtimes. Restore therefore requires a compatible signed Pidex release capable of reading or migrating the recorded versions.

Pidex closes the staged bundle, reads it back, decrypts it, and verifies every manifest entry before declaring the bundle ready. It then resumes normal Host acceptance before export. A paired PWA may download the bundle through a resumable, hash-checked transfer; the CLI may copy it to a Host-visible local, removable, or network path and read it back there.

Presentation distinguishes these facts:

- **Bundle verified** means the complete staged ciphertext was read back, decrypted, and matched its manifest.
- **Delivered and stream-verified** means a Client received every expected byte, but an ordinary browser download could not prove the final saved file is readable from its destination.
- **Destination verified** means Pidex subsequently read and fully verified the saved file, either automatically for a CLI-visible destination or through an explicit PWA Verify Backup selection.

Exported portable files belong to the user. Pidex never rotates or deletes them automatically. It retains a non-secret catalog record containing bundle identity, content hash, creation barrier, compatibility basis, and observed verification state. Host staging is disposable and expires after a bounded grace period; catalog metadata remains after staging cleanup.

### Verification and integrity maintenance

Online snapshot creation verifies database consistency, the snapshot manifest and reference closure, every new or changed recovery object, and prior verification evidence for unchanged objects. Portable creation and every restore perform complete end-to-end verification rather than trusting a prior catalog status.

Low-priority incremental background scrubbing covers the live database, immutable stores, Pi checkpoint evidence, local recovery store, snapshot manifests, and backup catalog. Subject to foreground load and health, all online retained bytes and references receive complete coverage within a monthly window. Portable files on disconnected or user-owned media are checked only when the user supplies them for Verify Backup or restore.

When a scrub finds a missing or corrupt immutable blob or Pi artifact generation, Pidex may repair it automatically only from an independently verified copy whose provenance and cryptographic identity prove exact equality. It quarantines the damaged object, materializes and verifies replacement bytes, activates them atomically, and records the source and evidence. Approximate reconstruction is forbidden. Unprovable damage isolates the smallest affected scope; corrupt SQLite, Host identity, or global invariants enters Host recovery mode rather than triggering silent rollback.

Orphan cleanup uses two-pass quarantine. Maintenance first classifies a candidate, proves it unreachable against a stable authority and every protected recovery or rollback manifest, and tombstones or quarantines it for a type-specific grace period. A later independent scan must prove it still unreachable before deletion. Any uncertainty retains or restores the candidate. Cleanup never follows a path or reparse point outside the managed data roots.

### Storage pressure

Pidex reserves emergency headroom for SQLite and WAL operation, accepted-Run settlement, cancellation and Stop evidence, Device revocation, maintenance bookkeeping, and recovery diagnostics. Admission control begins before that reserve is consumed.

Automatic pressure cleanup may remove only proven disposable data: abandoned staging after grace, two-pass verified orphans, expired diagnostics and caches, unsupported rollback generations, and unprotected daily snapshots outside the seven-point retention window. It may not automatically delete authoritative Sessions, Timelines, blobs, required Pi artifacts, minimum receipt or synchronization windows, protected rollback points, or manual snapshots.

If safe cleanup cannot restore the admission reserve, the Host enters storage-protection mode. It rejects new Runs, Forks, uploads, pairing, and other discretionary growth while preserving reads and the minimum writes required to settle accepted work, cancel or Stop work, revoke Devices, run cleanup, create an export or backup when space permits, and record diagnostics. Pidex never continues best-effort acceptance until arbitrary writes fail.

### Recovery presentation and authority

Normal PWA navigation provides a Recovery page containing local snapshot age and retention, protected points, portable-backup catalog and verification states, current maintenance operations, integrity coverage and findings, recovery-store usage, storage-pressure state, and explicit create, export, verify, delete, and restore actions. Backup and integrity health does not create global shell banners; an operation rejected by storage protection explains the condition contextually and links to Recovery.

Global database, Host-key, or invariant failure disables LAN product service and mDNS. Host recovery mode is available only through the signed CLI and the localhost recovery page opened with its short-lived capability. Previously paired Devices are not accepted while global authorization is uncertain. Isolated blob or Session-artifact faults remain scoped in normal operation where the unaffected authority is still trustworthy.

While normal authority remains valid, any currently paired Device has the same authority to initiate whole-Host restore as every other paired Device. Pidex introduces no recovery role. The restore command and source are revision-preconditioned and explicitly confirmed like other consequential Host mutations. Once global recovery mode has begun, however, restore is Host-local only.

### Restore and rollback safety

Restore is whole-Host replacement, never merge, selective import, or clone. Pidex fully verifies current source bytes, identity, manifests, reference closure, encryption, and version compatibility before materialization. It tests local candidates newest-first, preserves and marks failed candidates with their evidence, and preselects the newest fully verified compatible point. It discloses skipped points, the resulting rollback range, affected Runs and Devices, identity and canonical origin, and migration requirements. Activation always requires an explicit Restore action; Pidex never silently rolls backward. Choosing an older point or an identity-changing recovery path requires stronger confirmation.

The stopped daemon materializes a new data generation, performs supported migrations, verifies the result, and atomically activates it. The replaced or damaged generation remains preserved for explicit cleanup. Failure before the restored generation accepts mutations returns to the prior generation where safe; after mutation acceptance, further rollback again requires managed restore. Every activation rotates the synchronization epoch, invalidates old cursors, and forces all Clients to reset.

An online snapshot retains DPAPI-bound Host and CA envelopes and is recoverable only under the same Windows identity or an equivalent DPAPI recovery environment. A portable backup transfers the original Host identity and private CA to replacement hardware. Preflight detects a live canonical-origin or identity collision where possible and requires confirmation that the original Host is retired. V1 does not offer “restore as new identity,” clone, or selective transfer.

Device authorization is restored exactly as captured. This deliberately means a Device revoked after the recovery point can become Paired again; the restore preview must identify the captured Device basis and state this anti-rollback risk. Pidex does not maintain a second monotonic revocation authority outside SQLite.

Captured nonterminal execution never resumes automatically. Executing or cancelling Runs become Interrupted, and their worker-bound open Interactions become withdrawn. Captured queued Runs remain accepted but enter an explicit recovery hold; they dispatch only after user review and release under the established abnormal-outcome rules. Pidex does not replay commands to reconstruct work that may have happened after the recovery barrier.

### Reidentify and evidence export

If product data fully verifies but Host trust keys are unrecoverable and no usable portable identity backup exists, v1 supports explicit **Reidentify** through localhost recovery. Before commitment, Pidex creates the strongest verified encrypted export still possible. Reidentify then creates a new Host identity, canonical origin, private CA, and synchronization epoch around the verified product data. It invalidates every captured Device authorization and requires fresh pairing. It preserves data, but explicitly records that the old Host's cryptographic continuity ended; it is not key rotation, restore, or a second Host copy.

If global authoritative state itself is corrupt, recovery export does not attempt selective salvage. Pidex may create an encrypted evidence package containing the damaged generation, intact immutable stores, manifests, and diagnostics, but labels it non-restorable. Only a dataset that passes complete authority and reference validation may become a restorable package. Automated row extraction, relationship guessing, silent omission, and last-write-wins repair remain forbidden.

Exact byte reserves, pressure thresholds, drain and staging deadlines, scrub throughput, orphan grace periods, restore performance baselines, and failure-injection acceptance cases belong to [Set the quality and acceptance bar](11-set-quality-and-acceptance-bar.md).
