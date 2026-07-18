# Pidex PWA information architecture prototype

Three responsive information-architecture variants, switchable with the floating bar or `?variant=A`, `?variant=B`, and `?variant=C`.

- **A — Codex clone baseline:** close structural and visual clone with Pidex terminology, Project/Workspace-grouped Sessions, one primary conversation, and only per-Session state cues.
- **B — Supervision board:** Host overview first, with conversation work in a detail drawer.
- **C — Client-local tabs:** project tree, ephemeral View tabs, conversation, and Session inspector.

Variant A also compares Interaction placement with `?interaction=N|A|B|C|D`: none, pinned above the normal composer, inline only, composer takeover, and modal dialog.

Use `?connection=offline` or `?connection=reconnecting` on variant A to inspect stale-cache presentation; desktop uses the fixed sidebar status and mobile adds a compact header row while the drawer is closed.

Run from the repository root:

```bash
node .scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/serve.mjs
```

Then open <http://localhost:4173/?variant=A>. This is a read-only, throwaway prototype; it does not implement authoritative mutations or persistence.
