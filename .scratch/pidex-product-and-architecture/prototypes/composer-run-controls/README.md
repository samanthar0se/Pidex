# Composer and Run Controls Prototype

Four behavior variants for issue 65, switchable with `?variant=A`, `B`, `C`, or `D`, plus representative state with `&state=quiet`, `executing`, `queued`, `held`, `offline`, or `uncertain`.

Run from the repository root:

```sh
node .scratch/pidex-product-and-architecture/prototypes/composer-run-controls/serve.mjs
```

Open <http://localhost:4175/?variant=A&state=executing>.

- **A — Intent beside submit:** one persistent draft; while executing, the user explicitly chooses `Steer current Run` or `Queue follow-up` beside the send affordance.
- **B — Two-lane composer:** steering and follow-up are separate visible lanes with separate drafts.
- **C — Contextual default:** one draft and one send action; the current Run context determines steering or follow-up, with a compact menu to change intent.
- **D — Selected behavior:** during execution, non-empty submit implicitly steers and an empty submit affordance becomes exact-target Stop. Model and mode configure the next Run. Held follow-ups remain separate above the Composer.

This is a throwaway prototype. Controls mutate only in-memory presentation state.
