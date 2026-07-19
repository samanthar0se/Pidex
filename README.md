# Pidex

Pidex is a Windows-first, PWA-first control plane for durable [Pi](https://github.com/badlogic/pi-mono) coding sessions on a local LAN. One authoritative **Host** owns execution and state; paired desktop and mobile **Devices** can reconnect to, supervise, and control the same Sessions.

> **Status:** this repository is a v0.1 implementation scaffold with a working Host, protocol, PWA, persistence, deterministic adapters, and product-level tests. The signed Windows package, native Windows bridge, and real Pi adapter are not bundled yet.

## Core Model

- A **Session** is a durable conversation; a **Run** is one accepted execution cycle within it.
- Session retention (`available`/`archived`) and runtime residency (`resident`/`sleeping`) are independent.
- A **Device** is a paired app/browser identity; a **Client** is one live tab or window; a **View** is presentation only.
- The Host is the sole authority. Clients change shared state only through revision-preconditioned commands and reconcile through snapshots and typed Change Sets.
- Accepted work receives durable receipts and exactly one terminal outcome. Uncertain mutations are never replayed to discover whether they committed.
- Pi workers isolate Session failures but are not security sandboxes. The LAN is treated as hostile; product data requires authenticated Devices.

## Repository Map

- `apps/pwa/` — dependency-free PWA, offline working set, pairing, and Session UI.
- `packages/host/` — HTTPS/WebSocket Host, SQLite authority, workers, lifecycle, backup, recovery, and release gates.
- `packages/protocol/` — versioned Zod schemas and capability negotiation.
- `packages/adapters/` — Pi, clock, storage, network, and Windows seams; includes deterministic test adapters.
- `packages/launcher/` — Windows installation, supervision, lifecycle, and signed-update logic.
- `packages/cli/` — local control CLI surface; only `status` runs without the packaged launcher adapter.
- `test/` — end-to-end product contract tests using Node's test runner.
- `docs/` — maintained security, architecture, operations, and release-evidence guidance.
- `.scratch/pidex-product-and-architecture/` — product specification, domain glossary, decision map, and throwaway UI prototype.

## Development

Requires Node.js 22+.

```powershell
npm ci
$env:PIDEX_ADAPTERS = "deterministic"
npm run dev
```

The development Host serves `https://localhost:7443` using generated local certificate material in `.pidex-data/`. The deterministic adapter returns predictable Pi responses and avoids the unbundled native Windows bridge. Optional environment variables are `PIDEX_DATA_DIR` and `PIDEX_PORT`.

```bash
npm run typecheck
npm test
npm run security
```

For access from another LAN device, read `docs/development-lan-access.md`; never commit `.pidex-data/`.

## Agent Guidance

Before changing behavior, read:

1. `.scratch/pidex-product-and-architecture/CONTEXT.md` for canonical terminology.
2. The relevant sections of `.scratch/pidex-product-and-architecture/SPEC.md` for normative requirements.
3. Relevant files in `docs/`, especially `docs/security.md` and `docs/architecture-decisions.md`.
4. `AGENTS.md` and any scoped agent instructions.

Issues and PRDs are tracked in GitHub Issues. Keep changes narrow, preserve Host authority and failure boundaries, and add or update the closest product-level test.
