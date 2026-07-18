# Deterministic fault and recovery evidence (PRD: Build Pidex v1)

`DeterministicFaultCampaign` is the blocking, fail-closed release manifest. Each
build records both sides of every durable boundary, every process, transport,
storage/time, security/operations scenario, and every recovery drill. Each
observation must prove single Host authority, exactly one ordered outcome for
accepted work, no uncertain replay, and smallest-scope isolation.

Faults are triggered by named test seams (not timing or probability), with a
fresh isolated fixture and controlled clock/storage/transport/process adapter.
Evidence records the build and all attempts. The lowest-numbered attempt is
authoritative: later retries may collect traces but cannot replace failed
blocking evidence. Missing, non-deterministic, failed, or incomplete invariant
evidence blocks promotion.
