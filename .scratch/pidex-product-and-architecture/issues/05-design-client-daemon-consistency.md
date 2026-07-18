Type: grilling
Status: resolved
Blocked by: 04

## Question

What versioned command, snapshot, timeline, sequencing, idempotency, capability-negotiation, and reconnect model keeps multiple PWA clients consistent with the daemon?

## Comments

The consistency contract was resolved through a live grilling session. `Session Timeline` was added to the canonical glossary in [`../CONTEXT.md`](../CONTEXT.md).

## Answer

### Authority and transport

The Host is the only authority for shared Pidex state. Clients hold projections, pending-intent UI, and immutable cached history; none becomes authoritative because a command was sent or a message was rendered.

Each Client uses one authenticated, version-negotiated WebSocket as its control plane for synchronization scopes, snapshots, change sets, commands, command outcomes, acknowledgements, and heartbeats. HTTP is the data plane for PWA assets, immutable Timeline pages, exports, and content blobs. Domain order comes from Host commits and cursors, never from transport arrival alone.

Authoritative Client projections have exactly two write paths: installing a Host snapshot or applying a Host change set. A command response never independently patches authoritative Client state. The issuing Client may show a clearly non-authoritative pending overlay until the stream reaches the command's commit cursor.

### Protocol and capability handshake

The opening handshake binds the connection to the expected Host identity and negotiates a compatible Pidex protocol major and minor. Minor versions may add fields and negotiated behavior without changing existing semantics; no common major produces an explicit update-required state rather than a silent downgrade.

The Host advertises stable, versioned capability identifiers and constraints, including optional capabilities derived from the pinned Pi worker. Commands declare the capabilities they require and are rejected if the negotiated connection does not have them. The Host emits only message types admitted by the negotiated protocol and capability set.

Schemas define which optional fields may be ignored. An unknown change type, unsupported required capability, or other unknown semantic transition is a protocol fault: the Client stops applying projection updates and upgrades or reconnects. It never skips an unknown state transition while continuing to present its projection as current.

### Cursors, revisions, and atomic changes

Every committed user-visible Host change advances one Host-wide monotonic synchronization sequence. The externally carried Synchronization Cursor is opaque and includes the durable Host identity, a synchronization epoch, and that sequence. Normal daemon and Host restarts preserve cursor continuity. A backup restore, continuity-breaking migration, synchronization-log rebuild, or other possible rollback rotates the epoch and forces authoritative resets. Reaching another Host identity aborts reconciliation.

The Host emits each atomic commit as one cursor-stamped Change Set containing schema-defined projection changes. A Client applies a Change Set and advances its locally stored cursor in one transaction, then acknowledges that cursor. Delivery alone is not acknowledgement. If application fails, reconnect resumes from the prior committed cursor and may redeliver safely.

Because Clients receive only changes relevant to their subscribed scopes, observed Host sequence values need only increase, not be contiguous. Each mutable resource also has a monotonic resource revision. Delta changes name their required base revision and resulting revision; a mismatch makes the affected scope non-current and triggers an authoritative scope reset. Resource revisions are concurrency facts, while the Host cursor is a synchronization position; neither substitutes for the other.

Change Sets use typed Pidex projection messages such as resource summary upsert or removal, Timeline entry append or revision, output delta, Run-state change, and interaction change. Pidex does not expose generic JSON Patch paths, daemon persistence events, or Pi SDK objects as its Client contract.

### Synchronization scopes and snapshots

Every Client synchronizes a lightweight Host scope containing negotiated capabilities and summaries needed for discovery and multi-Session supervision. It subscribes separately to detailed Session scopes as Views require them. A subscription is ephemeral delivery interest only: it does not wake, sleep, archive, restore, open, close, or otherwise own a Session.

Starting or resetting a scope establishes a snapshot barrier. The Host captures a snapshot stamped with its scope, cursor, resource revisions, protocol version, and capability basis, buffers later relevant Change Sets, and sends those changes only after the Client atomically installs the snapshot. Adding a scope later uses a fresh barrier for that scope; it never assumes that the Client's existing Host cursor implies possession of that scope's state.

A temporary transport loss preserves the Client identity, requested scope set, cached projections, pending command identities, and last atomically applied cursor. The Client reconnects with that basis. If the Host still retains compatible changes, it resumes after the cursor. If the cursor, epoch, protocol basis, or relevant scope history is no longer resumable, the Host explicitly resets the affected scopes with fresh snapshots. The Client replaces those authoritative projections; it never merges cached and Host authority.

Reload or close-and-reopen creates a new Client under the same paired Device. Reusable Device caches remain non-authoritative and are governed by the follow-up offline and background decision.

### Host-owned Session Timeline

Clients consume a Host-owned Session Timeline rather than Pi history directly. It is an ordered projection with stable entry identities and order keys covering prompts, assistant and model output, tool activity, structured interactions, Run boundaries and outcomes, and user-visible cancellation, interruption, recovery, and lifecycle notices. Pi history is one input to this projection, not its schema or authority boundary.

A live Timeline entry has a monotonic entry revision. A delta names the entry, required base revision, and resulting revision. The Host may coalesce runtime output into protocol deltas rather than preserving token boundaries. A scope snapshot always contains the consolidated current entry, so compacted deltas are not required to reconstruct it. Finalization makes an entry immutable; later corrections or recovery facts append new entries rather than rewriting finalized history.

A Session snapshot contains its metadata, current and queued Runs, unresolved interactions, and a bounded recent Timeline window. Older finalized entries are retrieved over HTTP through stable cursor pagination and may be cached by a Device. The live stream covers the mutable tail and newly appended entries. Thus every Session's complete history remains reachable without making reconnect snapshots grow without bound.

### Commands, concurrency, and receipts

Every mutation is a versioned command with a Device-scoped unique Command ID, target identities, required capability basis, and command-specific preconditions describing the exact observed revisions or state facts on which the user's intent depends. The Host serializes authoritative commits, reevaluates those preconditions against current state, and either accepts the command atomically or returns a typed rejection. It may accept a command despite unrelated intervening changes, but it never silently retargets, converts, merges, or overwrites intent invalidated by a race.

Examples include targeting Stop at the exact executing Run, steering at the observed Run and state, responding to the exact unresolved interaction revision, and renaming against the observed metadata revision. A stale or conflicting rejection identifies the failed precondition and supplies current revisions or a reconciliation pointer. Session-local ordering such as accepted queued Runs is assigned by the Host at durable acceptance.

Command retry safety ends at the Host's durable acceptance boundary. In the same transaction as an accepted domain change, the Host records a durable receipt containing the Command ID, a digest of the command envelope, its authoritative outcome, and any commit cursor. Repeating the identical command returns the recorded outcome without executing it again; reusing an ID with different content is rejected. Rejected commands may likewise be recorded so a retry receives the same result.

Worker execution begins from durable Host state after acceptance. A command retry therefore never blindly repeats an uncertain Pi mutation, filesystem effect, model call, tool call, or network side effect. This is at-most-once Host command handling with durable outcome replay, not a claim of transactional or exactly-once external side effects.

The handshake gives commands a Host-issued validity context and bounded receipt window. The persistence and quality decisions will set its duration, but the semantic rule is fixed: once that window has expired and a receipt can no longer be proven, a retried command is rejected as expired or indeterminate and requires authoritative reconciliation. It is never executed as a new command merely because its old receipt was compacted.

Command outcomes report the Command ID, accepted or rejected state, a typed result or reason, and the commit cursor where applicable. A response and its Change Set may arrive in either order. The Client correlates them but changes its authoritative projection only through the stream.

### Slow Clients and failure behavior

Each Client has a bounded outbound queue. The Host may coalesce only changes explicitly defined as replaceable while preserving the semantics and order of atomic Change Sets. If a Client cannot keep up within that bound, the Host stops delivery and closes the connection with a typed resynchronization reason. The Client then resumes from its last acknowledged cursor or receives scope resets.

A slow, disconnected, crashed, backgrounded, or incompatible Client never backpressures a Session worker, delays Run settlement, or blocks sibling Clients. The Host never drops arbitrary deltas and allows a Client to continue as though its projection were current.
