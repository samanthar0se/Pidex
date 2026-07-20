# Bootstrap architecture decisions (PRD: Build Pidex v1)

- **Stack and boundaries:** Node.js/strict TypeScript packages separate protocol, adapters, Host authority, and CLI; the browser PWA is dependency-free ES modules. These are reversible package boundaries and preserve a Node worker seam for Pi.
- **Authority and transport:** Node's SQLite binding uses WAL and `synchronous=FULL`. HTTPS serves PWA assets and a `ws` WebSocket control plane. Protocol 1.0 uses schema-shaped UTF-8 JSON; later compatible codecs can sit behind the protocol package.
- **Identity and synchronization:** opaque UUID-qualified Host identity, epoch, and monotonic sequence are committed once in SQLite. Status is an initial `host.snapshot`, and CLI and PWA consume the same public transport contract.
- **Testing:** Node's test runner drives real HTTPS, WebSocket, PWA assets, CLI client, and SQLite. Isolated temporary data roots make tests repeatable. A versioned adapter bundle selects deterministic Pi/model/tool, clock, network, storage-fault, and Windows behavior without changing product contracts.
- **Bootstrap limits:** the generated localhost certificate and unauthenticated status snapshot are developer-only scaffolding. Canonical private-CA identity, Device authentication, and LAN exposure belong to their dedicated follow-up issues.

## Canonical Windows Host installation (issue 02)

- A signed per-user release contains its runtime under an immutable release ID; a stable launcher is the only Task Scheduler logon target and acquires the per-user singleton lock before starting it without a console.
- Setup commits a random 80-bit `pidex-<hex>.local` name and fixed port 47831 once. Updates consume this durable identity rather than deriving it from the computer or network name.
- A Host-private CA signs the canonical leaf. Private keys are stored only as versioned current-user DPAPI envelopes under a user-only ACL; only the public CA enters Current User trust. Native Windows operations remain behind the platform adapter.
- Launcher readiness is bounded at 15 seconds. Five delayed retries use 1/2/4/8/16 seconds, then publish a circuit-open cause to the local recovery surface. The same supervisor function is the explicit retry path; the daemon and LAN workers are never started while the circuit remains open.

## Windows Development CA (issue 43)

- Development checkouts share one CA under `%LOCALAPPDATA%\Pidex\development-ca`; only disposable server leaves remain in checkout data. Run `npm run dev-ca:setup` once before `npm run dev`. Setup is idempotent and exports only the public certificate path.
- Startup never creates or repairs the Development CA. Use `npm run dev-ca:reset` followed by setup for missing, partial, corrupt, mismatched, or expired state; this deliberately changes trust for every checkout and LAN client.
- Historical checkout-local CA material is not migrated. Remove old checkout TLS material, never copy a CA private key to a client, and trust only the profile CA's public certificate.
