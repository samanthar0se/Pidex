# 44 — Prove module and future-workspace seams

**What to build:** Demonstrate that bundled feature modules can contribute typed authority, persistence, lifecycle, diagnostics, worker services, and semantic UI without bypassing the kernel or making Sessions own future workspace/process resources.

**Blocked by:** 27 — Complete the desktop Session experience; 33 — Retain and garbage-collect durable stores safely; 36 — Detect and isolate corruption

**Status:** ready-for-agent

- [ ] The kernel registers namespaced immutable module identities/versions, resource kinds, protocol families, capabilities, storage families, diagnostics, lifecycle services, and UI contributions before readiness.
- [ ] Durable module-owned objects use opaque type-qualified Host-local IDs and declared Project/Workspace relationships; paths/process IDs/URLs remain mutable locators.
- [ ] Module commands, results, snapshots, Change Sets, and worker requests retain kernel authentication, targets, capabilities, revisions, receipts, cursors, validation, and backpressure.
- [ ] Modules own namespaced SQLite schemas/blob kinds and supply deterministic migration, integrity, backup/reference, retention, and restore participation without private authoritative databases.
- [ ] A Session worker can request a typed Host action, but only the daemon can accept it durably, invoke the owning module, and publish authority.
- [ ] Semantic UI slots cover destinations/details, actions, status/diagnostics, Timeline renderers, and Interaction renderers while the shell owns routes/layout/View lifecycle.
- [ ] A missing/incompatible module preserves identity/schema/provenance/bytes, marks affected kinds unavailable, blocks affected commands, and leaves unrelated Host/Session/recovery behavior available.
- [ ] Contracts demonstrate that future Terminals/Managed Processes use separate Host-owned Jobs, Electron remains another Device/Client, and tunnels remain transport adapters; no third-party loader is implemented.
