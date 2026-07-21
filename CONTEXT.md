# Pidex

Pidex is a local control plane whose Host owns authoritative execution and durable state while Devices supervise it.

## Language

**Durability coverage**:
The Host's classification of whether its authoritative storage falls within Pidex's promised sudden-power-loss boundary. It is `covered`, `outside-boundary`, or `indeterminate`.
_Avoid_: Storage health, durable storage

**Windows-reported fixed NTFS**:
A volume that reports the NTFS filesystem and the Windows `DRIVE_FIXED` logical drive type. It is Pidex's runtime coverage boundary, not a claim of physical locality or hardware qualification.
_Avoid_: Fixed local NTFS

**Covered**:
Pidex has established that the authoritative storage falls within its promised durability boundary.

**Outside-boundary**:
Pidex has established that the authoritative storage falls outside its promised durability boundary.

**Indeterminate**:
Pidex cannot establish whether the authoritative storage falls within its promised durability boundary.
_Avoid_: Unknown, covered

**Authority generation**:
A complete Host authority state selected as one recovery unit, comprising the SQLite authority and its immutable-file reference closure. Exactly one Authority generation is selected for mutation; retained predecessors are recovery bases.

**Activation index**:
A monotonic ordering of Authority-generation activations. It records activation order independently of fact sequence, wall-clock time, or generation identity.

**Generation selector**:
A reconstructible hint naming the selected Authority generation. It accelerates normal startup but is not itself Host authority.
_Avoid_: Source of truth, authoritative pointer

**Development CA**:
The long-lived private certificate authority shared by every Pidex development checkout and worktree for one Windows profile. Each client trusts its public certificate once; replaceable development leaves renew under the same CA.
_Avoid_: Developer trust anchor, production CA

**Durable acknowledgment**:
Pidex's confirmation that accepted work and its dependencies crossed the applicable durable-publication boundary. It is conditional on the storage stack honoring successful flushes and does not claim that arbitrary hardware preserves the newest generation.

**Pidex companion extension**:
A separately versioned Pidex extension paired with supported Pi extension identities and versions. It translates explicitly registered, namespaced, data-only capabilities between worker-local Pi behavior and Host or Device surfaces; it does not tunnel raw Pi SDK objects or automatically render arbitrary Pi TUI components.

**Session attention summary**:
A user-facing discovery cue derived from exact Session, Run, and Interaction facts. It is `quiet` when no accepted work is progressing and no explicit user action can advance blocked work, `working` while accepted work progresses without user action, or `needs response` when explicit user action can advance blocked work. Read status is independent. It is not a Session lifecycle state.
_Avoid_: Active Session, idle Session, Session state

**Session read-through position**:
The Host-global Timeline revision through which a current View has visibly presented a Session's authoritative tail. It is monotonic and shared across all paired Devices.
_Avoid_: Read cursor, Device read position

**Session read-state revision**:
A Session-local monotonic revision of its projected read-through position and derived read status. It is ordered for delivery by the Host synchronization cursor and is independent of Timeline and metadata revisions.
_Avoid_: Read cursor, Read metadata revision

**Unread-producing milestone**:
An authoritative Session Timeline fact that can make a Session unread: an Interaction opening or a Run reaching Completed, Failed, Cancelled, or Interrupted. User-originated facts and intermediate Run progress are not unread-producing.

**Unread-milestone basis**:
The newest unread-producing milestone's Timeline revision persisted by Host authority for a Session, or no milestone when none exists. It is internal derivation state, not a Device-visible projection revision.

**Session read status**:
A discovery cue derived by comparing the newest unread-producing milestone with the Session read-through position. It is `unread` when the milestone is later and `read` otherwise; Session attention summary is independent.
