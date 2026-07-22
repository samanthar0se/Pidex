# Bootstrap architecture decisions (PRD: Build Pidex v1)

- **Stack and boundaries:** Node.js/strict TypeScript packages separate protocol, adapters, Host authority, and CLI; the browser PWA is dependency-free ES modules. These are reversible package boundaries and preserve a Node worker seam for Pi.
- **Authority and transport:** Node's SQLite binding uses WAL and `synchronous=FULL`. Plain HTTP serves React Client assets and a `ws` WebSocket control plane. Protocol messages use schema-shaped UTF-8 JSON.
- **Identity and synchronization:** opaque UUID-qualified Host identity, epoch, and monotonic sequence are committed once in SQLite. Status is an initial `host.snapshot`, and CLI and PWA consume the same public transport contract.
- **Testing:** Node's test runner drives real HTTP, WebSocket, React Client assets, CLI clients, and SQLite. Isolated temporary data roots make tests repeatable.

## Windows Host installation (issue 02, transport superseded by PRD #163)

- A signed per-user release contains its runtime under an immutable release ID; a stable launcher is the only Task Scheduler logon target and acquires the per-user singleton lock before starting it without a console.
- Packaged execution defaults to port 47831. Addresses are locations only and are not durable identity.
- Launcher readiness is bounded at 15 seconds. Five delayed retries use 1/2/4/8/16 seconds, then publish a circuit-open cause to the local recovery surface. The same supervisor function is the explicit retry path; the daemon and LAN workers are never started while the circuit remains open.
