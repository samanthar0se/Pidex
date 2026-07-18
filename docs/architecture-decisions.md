# Bootstrap architecture decisions (PRD: Build Pidex v1)

- **Stack and boundaries:** Node.js/strict TypeScript packages separate protocol, adapters, Host authority, and CLI; the browser PWA is dependency-free ES modules. These are reversible package boundaries and preserve a Node worker seam for Pi.
- **Authority and transport:** Node's SQLite binding uses WAL and `synchronous=FULL`. HTTPS serves PWA assets and a `ws` WebSocket control plane. Protocol 1.0 uses schema-shaped UTF-8 JSON; later compatible codecs can sit behind the protocol package.
- **Identity and synchronization:** opaque UUID-qualified Host identity, epoch, and monotonic sequence are committed once in SQLite. Status is an initial `host.snapshot`, and CLI and PWA consume the same public transport contract.
- **Testing:** Node's test runner drives real HTTPS, WebSocket, PWA assets, CLI client, and SQLite. Isolated temporary data roots make tests repeatable. A versioned adapter bundle selects deterministic Pi/model/tool, clock, network, storage-fault, and Windows behavior without changing product contracts.
- **Bootstrap limits:** the generated localhost certificate and unauthenticated status snapshot are developer-only scaffolding. Canonical private-CA identity, Device authentication, and LAN exposure belong to their dedicated follow-up issues.
