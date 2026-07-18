Type: grilling
Status: resolved
Assignee: pi
Blocked by: 02, 04, 05, 08

## Question

Which module, protocol, identifier, storage, UI, and contribution seams must the core preserve so files, Git, worktrees, terminals, background processes, Electron, remote tunnels, and a later Pidex-native extension framework can be added without redesigning session ownership?

## Comments

This decision was resolved through a live grilling session. It adds no generic `Resource` aggregate to the domain language: the resource catalog and feature modules below are architectural mechanisms, while Project, Workspace, Session, Run, Device, Client, and View remain the canonical product terms.

## Answer

### Ownership and module boundary

Future workspace tooling extends the Host beside Sessions, not inside them. A Session may target, inspect, or request actions against another Host-owned object, but it never owns that object's identity, persistence, supervision, or lifetime. Session scope remains the immutable optional Project and Workspace association already defined; adding tooling does not turn the Session into a workspace container.

Pidex preserves a small authority kernel and typed feature modules:

- The kernel owns Host-local identity and type registration, authentication and authorization, command validation and durable receipts, revisions and synchronization, transaction and migration orchestration, blob publication, lifecycle-supervision services, capability negotiation, diagnostics, backup participation, and failure isolation.
- A feature module owns the schema, invariants, commands, projections, lifecycle policy, diagnostics, and UI contributions of its concrete resource kinds. It receives explicit versioned Host services instead of daemon object graphs, raw network listeners, unrestricted database handles, or direct access to Client state.
- Cross-module work is coordinated through typed IDs and kernel services. A module cannot mutate another module's tables, emit authoritative Client state outside a committed Change Set, or make its private state a second authority.

This is not one universal resource domain model. The kernel keeps only the common catalog facts needed to route and protect lifecycle-bearing objects—typed identity, owning module and version, valid Host/Project/Workspace scope, revision, availability, and module provenance. Concrete meaning stays in the owning module.

### Identity and resource granularity

Every durable module-owned object has an immutable, opaque, type-qualified, Host-local ID. Paths, Git references, operating-system process IDs, ports, URLs, provider handles, and similar values are mutable locators or attributes, never durable identity. Cross-module references carry typed IDs and the revisions or state preconditions required by the command. Namespaced identifiers for modules, resource kinds, protocol families, capabilities, and contribution kinds are collision-resistant, versioned where semantics require it, and never silently reused for another meaning.

Only objects whose lifecycle or durable Pidex-owned state needs independent control become cataloged resources:

- A Git worktree is represented as a Workspace within its Project; its filesystem path and repository metadata are locators and observed state of that Workspace.
- Files, directories, Git refs, commits, diffs, and ad hoc commands are typed, revision-preconditioned targets within a Workspace. Pidex does not mirror them all as durable aggregates merely because they are addressable.
- A Terminal, Managed Process, or configured tunnel endpoint receives a Host ID when Pidex owns its durable configuration, supervision, or lifecycle. A later module may introduce another resource kind only when it has genuine Pidex-owned lifecycle or state.

Each resource kind declares its allowed scope and relationships. The kernel rejects an invalid cross-Project or cross-Workspace reference before dispatch rather than allowing feature code to reinterpret Session ownership.

### Protocol seams

Feature modules extend the existing control-plane model through registered, namespaced, versioned protocol families. A family may define typed commands, command results, snapshots, projection changes, events, capabilities, and worker service requests. All schemas are registered before readiness and included in the negotiated capability basis.

The kernel envelope remains authoritative for Device authentication, Client and Command identity, target typing, required capabilities, revisions and preconditions, durable receipts, commit cursors, scope barriers and resets, ordering, acknowledgement, validation, backpressure, and typed failure. Modules cannot introduce an opaque payload channel that bypasses these rules. Unknown required module semantics reject the command or make only the affected synchronization scope non-current; Clients never skip them and continue as if current.

Daemon-to-worker module calls follow the same rule: they are correlated, capability-negotiated, schema-validated service requests. A Session worker may request a Host action, but only the daemon can accept it durably, invoke the owning module, and publish resulting authority. Workers never write module stores or Client projections directly. Existing Pi tools may still cause ordinary Host-user side effects; becoming a Pidex-owned resource requires crossing this explicit acceptance boundary.

### Storage and migration seams

Each module owns versioned, namespaced SQLite tables and indexes plus registered immutable blob kinds inside the existing core stores. It supplies deterministic migrations, integrity checks, backup enumeration, restore validation, retention hooks, and reference discovery through kernel orchestration. It does not create an authoritative private database, hide authoritative state in arbitrary files, or reduce structured state to an unvalidated generic key-value bag.

Kernel transactions may atomically update the resource catalog, command receipt, synchronization records, and participating module tables. Cross-module references use registered typed IDs and are validated at the transaction boundary. Blob publication retains the existing stage, flush, verify, rename, then reference ordering. Managed backup, restore, migration, corruption isolation, and garbage collection therefore continue to cover the whole Host without teaching the kernel each feature's semantics.

If an owning module is missing, incompatible, or fails startup, the kernel preserves its catalog records, schema, IDs, provenance, and bytes; marks the affected kinds unavailable with diagnostics; and blocks their commands, migrations, and dependent contributions. It does not delete or generically edit unknown module state. Unrelated Host, Session, Timeline, backup, export, and recovery functions remain available unless a separately proven global invariant is damaged.

### Process and lifecycle seams

A Session cannot detach or promote a descendant from its non-breakaway worker Job. Creating a Terminal or long-lived Managed Process is instead an explicit typed Host command from the start. After durable acceptance, the owning feature supervisor creates it in a separate contained Job and records its own lifecycle and revision. The initiating Session and Run may be retained as provenance, but never become its owner.

Such a resource continues or stops according to its explicit feature policy across Session cancellation, sleep, archive, worker replacement, and Client disconnection. Its commands target its own observed identity and revision. Host draining, forced shutdown, update, recovery, resource limits, and diagnostics operate through the kernel supervision interface rather than through Session worker cleanup. Exact Terminal and Managed Process states and default policies remain for their eventual feature specifications.

### UI contribution seams

The Client shell exposes versioned semantic contribution slots rather than allowing modules to own routes, layout, or Session lifecycle. Initial contribution kinds cover resource destinations and detail sections, commands and contextual actions, status and diagnostic items, Session Timeline renderers, and structured-interaction renderers. A contribution declares its namespaced identity, owning module, required capabilities, supported projection types, compatibility basis, and placement semantics.

Bundled client modules render registered typed projections into these slots. The PWA shell chooses responsive placement, navigation, loading, error, and unavailable states; opening or closing contributed UI remains a Client-local View action. A renderer cannot mutate authority except by issuing a normal versioned command, and Timeline or interaction renderers cannot redefine the Host-owned ordering or interaction state machine.

V1 executes no third-party UI code. The contracts preserve provenance and compatibility metadata so a later extension effort can choose packaging, sandboxing, permissions, and isolation without changing projection identity or semantic attachment points. The information-architecture prototype remains free to decide how these slots appear on desktop and mobile.

### Electron, tunnels, and future native extensions

Electron and remote tunnels attach at system edges rather than as Session features:

- A later Electron application is another Device and Client shell over the same PWA projections, commands, authentication, and consistency contract. A narrow versioned client-platform bridge may expose native affordances such as windowing, notifications, credential storage, and protocol activation, but it grants no privileged Session backchannel.
- A later tunnel is a Host transport and exposure adapter carrying the same authenticated HTTPS, WebSocket, Host identity, capability, command, and synchronization semantics. It may add transport establishment and endpoint lifecycle, but cannot become a second domain authority or weaken Device authentication.

Bundled trusted feature modules statically use the same manifest and registries reserved for a future Pidex-native extension loader. A manifest declares its namespaced identity and version, Host compatibility, protocol families, resource kinds, migrations, required and provided capabilities, diagnostics, lifecycle services, and UI contributions. Registration is deterministic, rejects collisions and incompatible dependencies, and completes before the Host advertises readiness.

These contracts are isolation-ready: trusted bundled modules may run in the daemon process in v1, but their service and message boundaries permit a later supervised extension host without changing resource identity, storage authority, or Client protocol. This effort does not freeze a public ABI or specify dynamic discovery, packaging, signing, permissions UX, sandboxing, extension distribution, or third-party loading; those remain a separate effort informed by concrete extensions.
