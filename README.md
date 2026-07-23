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

Requires Node.js 22+:

```powershell
npm ci
npm run dev
```

Development and unpacked startup use the pinned Pi SDK and the model/profile
configured in `~/.pi/agent`. Set `PIDEX_WORKSPACE` to choose the coding working
directory; it defaults to the Pidex checkout. Pi conversation state is retained
under the Host data directory per Session. Deterministic Pi is test-only.

The Host serves plain HTTP on IPv4 wildcard port 7443. `PIDEX_DATA_DIR`,
`PIDEX_PORT`, `PIDEX_PROJECT_PATH`, `PIDEX_PROJECT_NAME`, and `PIDEX_WORKSPACE`
may be set directly or in an untracked `.env` file. Development registers the
current checkout as the default Project; set `PIDEX_PROJECT_PATH` to use another
checkout. Git-backed Projects offer Local, new managed worktree, and existing
worktree choices when starting a Session.

### Background development Host

Pidex can run the development Host without an open terminal by registering a
per-user Scheduled Task. This intentionally uses the signed-in user's profile
and LocalAppData instead of a Windows service account. Stop any
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

The task's per-user `Interactive` logon mode is also required for Pi computer
use. The Host, Pi worker, helper, and target apps must share the signed-in,
unlocked Windows session; a Session 0 service cannot see desktop roots. See
`docs/computer-use.md` for the packaged-launcher constraint and verification
steps.

The development Host serves plain HTTP on IPv4 wildcard port 7443. Startup
prints the unauthenticated-prototype warning and loopback/LAN URL guidance.
Opening the URL goes directly to the React Client without credentials or setup.
See [Prototype LAN operation](docs/prototype-lan.md) for the complete operator boundary.

The development entry point explicitly uses deterministic adapters and cannot
select product composition through an environment switch. Optional fixture
environment variables are `PIDEX_DATA_DIR`, `PIDEX_PORT`,
`PIDEX_PROJECT_PATH`, and `PIDEX_PROJECT_NAME`;
explicit values override the development defaults.

```bash
npm run typecheck
npm test
npm run security
```

Never commit `.pidex-data/` or `.pidex-data-dev/`.

## Agent Guidance

Before changing behavior, read:

1. `.scratch/pidex-product-and-architecture/CONTEXT.md` for canonical terminology.
2. The relevant sections of `.scratch/pidex-product-and-architecture/SPEC.md` for normative requirements.
3. Relevant files in `docs/`, especially `docs/security.md` and `docs/architecture-decisions.md`.
4. `AGENTS.md` and any scoped agent instructions.

Issues and PRDs are tracked in GitHub Issues. Keep changes narrow, preserve Host authority and failure boundaries, and add or update the closest product-level test.
