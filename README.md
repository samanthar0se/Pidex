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

Requires Node.js 22+ and the OpenSSL CLI available on `PATH`. Verify both
before starting Pidex:

```powershell
node --version
openssl version
```

Git for Windows includes OpenSSL but does not expose it to Command Prompt by
default. Add `C:\Program Files\Git\mingw64\bin` to your user `PATH`, or expose
it for the current Command Prompt session:

```cmd
set "PATH=C:\Program Files\Git\mingw64\bin;%PATH%"
```

```powershell
npm ci
npm run dev:ca:setup
npm run dev
```

Development CA setup is an explicit, one-time operation for the current Windows
profile and must run before the first Host startup. It installs only the public
certificate in Current User Root and reports `created` for a new CA or
`unchanged` when the existing CA was validated and reused. Record the displayed
SHA-256 fingerprint and public certificate export location; the latter is the
only certificate file to distribute to a LAN client.

The development Host serves `https://localhost:7443`. Its disposable leaf and
private key remain in `.pidex-data-dev/`, while the shared Development CA stays
under LocalAppData and survives checkout deletion. Startup never creates or
repairs that CA. Open the printed pairing URL and select **Pair Device**.

### One-time clean break from older checkouts

Do not migrate, reuse, or search for an old CA. Remove historical checkout-local
TLS material (normally the old checkout's `.pidex-data-dev/tls/` directory),
then run `npm run dev:ca:setup` once. Never copy its old CA or private key into
the profile location.

Use `npm run dev:ca:reset` only when the shared Development CA is unusable or an
intentional trust break is required. Reset affects every checkout and all LAN
clients, attempts best-effort removal from Current User Root, and does not make
a replacement. Run `npm run dev:ca:setup` afterward; expect a new fingerprint
and repeat LAN-client trust. A missing OpenSSL executable is a prerequisite
failure, not unusable CA state: install OpenSSL, verify `openssl version`, and
rerun setup rather than resetting valid CA state.

The deterministic adapter returns predictable Pi responses and avoids the
unbundled native Windows bridge. Optional environment variables are
`PIDEX_ADAPTERS`, `PIDEX_DATA_DIR`, `PIDEX_PORT`, and deterministic-only
`PIDEX_HOSTNAME`; explicit values override the development defaults.

```bash
npm run typecheck
npm test
npm run security
```

For access from another LAN device, read `docs/development-lan-access.md`; never
commit `.pidex-data/` or `.pidex-data-dev/`.

## Agent Guidance

Before changing behavior, read:

1. `.scratch/pidex-product-and-architecture/CONTEXT.md` for canonical terminology.
2. The relevant sections of `.scratch/pidex-product-and-architecture/SPEC.md` for normative requirements.
3. Relevant files in `docs/`, especially `docs/security.md` and `docs/architecture-decisions.md`.
4. `AGENTS.md` and any scoped agent instructions.

Issues and PRDs are tracked in GitHub Issues. Keep changes narrow, preserve Host authority and failure boundaries, and add or update the closest product-level test.
