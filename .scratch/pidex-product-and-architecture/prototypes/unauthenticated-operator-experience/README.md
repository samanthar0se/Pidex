# Unauthenticated operator experience prototype

Three read-only variants answer one question: how should startup output, access URLs, browser connection states, setup guidance, and visible risk messaging work when Pidex has no certificates, pairing, or Client authentication?

- **A — Console only (selected):** concise startup output carries the required warning; the browser opens directly with no persistent risk UI.
- **B — Operator launchpad:** startup and first-open guidance emphasize choosing a local or LAN URL, with a compact persistent risk marker afterward.
- **C — Safety rail:** a fixed risk rail makes the network boundary part of the application chrome and pairs each access path with its consequence.

The floating bar switches variants with `←` and `→` or `?variant=A|B|C`. Use the state menu or `?state=current|reconnecting|stale|offline|update` to compare browser behavior. The Development and Packaged Host tabs change ports and setup wording without changing the security model.

Run from this worktree root:

```bash
node .scratch/pidex-product-and-architecture/prototypes/unauthenticated-operator-experience/serve.mjs
```

Then open <http://localhost:4175/?variant=A&state=current&mode=development>.

This is a throwaway prototype. It starts no Host, discovers no LAN address, changes no firewall rule, and performs no network mutation.

## Verdict

Select A as the lowest-work direction, with the warning confined to Host startup output. Do not add a browser warning strip, risk chip, safety rail, acknowledgement, or first-open interstitial. B and C remain rejected comparison sources.

## Captured comparisons

- [A — Console only, current Development Host](screenshots/A-current.png)
- [B — Operator launchpad, stale Packaged Host](screenshots/B-stale.png)
- [C — Safety rail, update-required Development Host](screenshots/C-update.png)
