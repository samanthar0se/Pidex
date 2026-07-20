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
