# Pidex

Pidex is a Windows-first control plane for durable [Pi](https://github.com/badlogic/pi-mono) coding sessions on a local LAN. One authoritative **Host** owns execution and state; browser and CLI Clients can reconnect to supervise and control the same Sessions.

> **Status:** the manifest-selected, source-runnable Windows Host has replaced the product scaffolds. This bounded claim does **not** claim installer readiness, signed distribution, daily-driver completion, or full v1 promotion.

## Core Model

- A **Session** is a durable conversation; a **Run** is one accepted execution cycle within it.
- Session retention (`available`/`archived`) and runtime residency (`resident`/`sleeping`) are independent.
- An **Anonymous Client** is one live browser tab or CLI process; a **View** is presentation only; a **Client environment** is shared non-authoritative browser storage.
- The Host is the sole authority. Clients change shared state only through revision-preconditioned commands and reconcile through snapshots and typed Change Sets.
- Accepted work receives durable receipts and exactly one terminal outcome. Uncertain mutations are never replayed to discover whether they committed.
- Pi workers isolate Session failures but are not security sandboxes. Prototype LAN reachability grants full control, so use only disposable, non-sensitive evaluation data on an operator-controlled LAN.

## Repository Map

- `apps/client/` — React Client, offline working set, and service worker.
- `packages/host/` — HTTP/WebSocket Host, SQLite authority, workers, lifecycle, backup, recovery, and release gates.
- `packages/protocol/` — versioned Zod schemas and capability negotiation.
- `packages/adapters/` — deterministic development/test adapters only; product startup cannot select them.
- `packages/launcher/` — Windows installation, supervision, lifecycle, and signed-update logic.
- `packages/cli/` — anonymous status and doctor CLI over explicit HTTP/WebSocket Host URLs.
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

`npm run dev` loads machine-specific development settings from an optional
untracked `.env` file in the repository root. For LAN access, create it with
the Host workstation's stable LAN address:

```dotenv
PIDEX_HOSTNAME=192.168.1.227
```

The repository ignores `.env`; do not commit machine-specific addresses or
secrets. Shell environment variables take precedence over values in the file.

### Background development Host

Pidex can run the development Host without an open terminal by registering a
per-user Scheduled Task. This intentionally uses the signed-in user's profile,
Development CA, and LocalAppData instead of a Windows service account. Stop any
terminal-hosted `npm run dev` process before installing the task:

```powershell
npm run dev:task:install
```

The task starts immediately and at each user logon. After updating the checkout
or `.env`, restart it with:

```powershell
npm run dev:task:restart
```

Task output is appended to `.pidex-data-dev/development-host.log`. Manage or
inspect the task with `npm run dev:task:status`, `npm run dev:task:stop`, and
`npm run dev:task:uninstall`.

The development Host serves plain HTTP on IPv4 wildcard port 7443. Startup
prints the unauthenticated-prototype warning and loopback/LAN URL guidance.
Opening the URL goes directly to the React Client without credentials or setup.

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

The development entry point explicitly uses deterministic adapters and cannot
select product composition through an environment switch. Optional fixture
environment variables are `PIDEX_DATA_DIR`, `PIDEX_PORT`, and `PIDEX_HOSTNAME`;
explicit values override the development defaults.

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
