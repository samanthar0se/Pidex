# Responsive mobile adaptation prototype

Three throwaway variants answer how the resolved desktop discovery, Timeline, Composer, Run-control, Interaction, and connection-state hierarchy should adapt to a narrow mobile Client while preserving exact-target control.

Run from the repository root:

```sh
node .scratch/pidex-product-and-architecture/prototypes/responsive-mobile-adaptation/serve.mjs
```

Open `http://localhost:4173/?variant=A&scenario=working`. Use the bottom switcher or left/right arrow keys to compare:

- **A — Direct collapse:** the desktop hierarchy folds directly into a Session header, slide-over drawer, Timeline, and floating control dock.
- **B — Context shelf:** Session and Run context stay in compact persistent shelves; the control surface becomes an edge-to-edge bottom sheet.
- **C — Focus deck:** the header stays quiet while exact Run target and Interaction context form a compact control deck.

The scenario menu covers an executing Run with empty or steering draft, multiple open Interactions, cached offline content, held follow-up work, and the discovery drawer. All controls are simulated and perform no Host mutation.
