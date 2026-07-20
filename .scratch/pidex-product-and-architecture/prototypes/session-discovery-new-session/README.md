# Session discovery and New Session prototype

Three read-only variants answer one question: how should the Codex-like shell help someone find, select, and create a Session without obscuring Project and Workspace scope?

- **A — Nested scope rail:** Projects contain Workspaces and their Sessions; New Session is a centered Composer with scope controls inside it.
- **B — Search-first catalog:** Sessions form one recency list with scope breadcrumbs and persistent facets; New Session gives scope selection equal weight with the Composer.
- **C — Workspace launch points:** the rail is a compact Project/Workspace tree with contextual create buttons; New Session inherits the launch scope and keeps it visible above the Composer.
- **D — Projects + Chats:** only Projects are accordions; scoped Sessions sit directly beneath them with Workspace as row metadata, and flat unscoped Chats follow below Projects.

The floating bar switches variants with `←` and `→` or `?variant=A|B|C`. Its scenario menu covers populated discovery, search matches and no results, an empty catalog, archived discovery, New Session, draft failure, capability absence, command failures, uncertain transport, and stale offline state.

Run from this worktree root:

```bash
node .scratch/pidex-product-and-architecture/prototypes/session-discovery-new-session/serve.mjs
```

Then open <http://localhost:4174/?variant=A&scenario=default>.

This is a throwaway prototype. Session selection and all create actions are local simulations; they do not wake a Session or perform Host mutations.

## Captured comparisons

| Variant | Discovery | New Session |
| --- | --- | --- |
| A — Nested scope rail | [Discovery](screenshots/A-discovery.png) | [New Session](screenshots/A-new-session.png) |
| B — Search-first catalog | [Discovery](screenshots/B-discovery.png) | [New Session](screenshots/B-new-session.png) |
| C — Workspace launch points | [Discovery](screenshots/C-discovery.png) | [New Session](screenshots/C-new-session.png) |
| D — Projects + Chats | [Discovery](screenshots/D-discovery.png) | [New Session](screenshots/D-new-session.png) |
