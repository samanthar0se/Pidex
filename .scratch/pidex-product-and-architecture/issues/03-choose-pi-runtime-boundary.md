Type: grilling
Status: resolved
Blocked by: 01

## Question

Should Pidex own Pi through one RPC subprocess per session, isolated SDK worker processes, or another boundary, and what compatibility and failure-isolation guarantees must that boundary provide?

## Comments

## Answer

Pidex v1 uses one isolated Node worker process per resident Session. Each worker embeds the exact Pi SDK version shipped with its Pidex release and is immutably bound to one Pidex Session for its lifetime. The daemon, not Pi's in-process session-replacement API, owns create, resume, fork, wake, sleep, and worker replacement. In-file conversation-tree navigation may remain inside the bound Session.

The worker imports only Pi's documented public SDK surfaces. It uses Pi's public resource loader so the pinned runtime preserves normal global and project resource discovery, including extensions, skills, prompts, settings, models, and credentials. As later resolved by [Set the LAN trust boundary](06-set-lan-trust-boundary.md), Pidex deliberately starts every worker with Pi project trust enabled for any working directory: the entire Host is inside v1's trust boundary, and users supply any stricter guardrails themselves.

Pi is hidden behind a versioned, Pidex-owned worker protocol rather than exposing SDK objects or mirroring Pi RPC as Pidex's domain contract. At startup, daemon and worker require an exact protocol-version match and the worker probes the Pi surface it depends on. Missing required capabilities fail startup with typed diagnostics; explicitly optional capabilities are advertised so clients can gate them. `pi --mode rpc` is neither the primary runtime nor a silent fallback. A broken or partial runtime upgrade must fail clearly instead of degrading a Session below the daily-driver promise.

The required v1 extension UI baseline is Pi's structured headless interaction surface: select, confirm, input, editor, notifications, status, widgets, title, and editor-text injection. Arbitrary `custom()` TUI components and terminal-panel emulation are not required in v1. The worker protocol reserves validated, namespaced capability and message seams for a later Pidex-native extension framework, but this effort does not specify or load third-party Pidex extensions.

Worker isolation is a reliability boundary, not a security sandbox. A Pi or extension crash, hang, memory leak, malformed message, or unhandled exception must not crash the daemon or disturb sibling Session workers, and all worker messages are schema-validated before affecting daemon state. Workers still run with the signed-in host user's filesystem, process, credential, and network authority; stronger privilege isolation is outside v1.

If a worker exits or its IPC channel is lost, only that Session's runtime is affected and every pending request is completed with a typed failure. Pidex never blindly replays an in-flight mutation whose acknowledgement was lost: the operation may already have reached Pi. Recovery must first reconcile authoritative Session state, after which later lifecycle and consistency decisions may define retries only where non-commitment or idempotency is proven.

Exact sleep/wake and crash recovery behavior, command sequencing and snapshots, persistence ownership, and Windows process-tree supervision remain delegated to their existing follow-up decisions.
