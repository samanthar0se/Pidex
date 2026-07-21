# Open Interactions workflow prototype

Three throwaway variants for Host-owned open Interactions inside the settled Codex-like Session View. Each lets the Interaction reversibly take over the full Composer shell, preserves the Device-local draft behind an explicit **Write message** switch, keeps exact-target Stop in the header, and leaves only durable facts in the Session Timeline.

- **A — Focused pager:** one request at a time with explicit previous/next navigation and a segmented surface switch.
- **B — Compact stack:** all requests remain scannable; a footer action switches to the Composer.
- **C — Split inbox:** a stable request list selects a response pane; an icon-level switch opens the Composer.

Run from the repository root:

```bash
node .scratch/pidex-product-and-architecture/prototypes/open-interactions/serve.mjs
```

Open <http://localhost:4174/?variant=B>. Switch variants with the floating bar or `?variant=A`, `B`, or `C`.

Use **Simulate competing Device** to inspect stale-race reconciliation. Normal responses briefly show Device-local pending intent, then reconcile from the simulated Host projection. This is an in-memory, throwaway prototype; it performs no authoritative mutations or persistence.

## Selected direction

**B — Compact stack with footer escape.** The stack takes over the Composer footprint while keeping all Host-ordered requests scannable and one expanded for response. **Write message** reveals the preserved Device-local draft without showing both surfaces at once.

- A newly open Interaction takes over automatically only when the draft is empty; a non-empty active draft keeps its focus and gains an updated request cue.
- After a request becomes terminal, it leaves the stack and the next Host-ordered request expands automatically.
- The Composer returns automatically when no open Interactions remain.
- Exact-target Stop remains directly reachable in the Session header throughout.
