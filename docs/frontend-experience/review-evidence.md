# Frontend Experience Review Evidence

## Review result

**Status: ready for delivery sequencing.** This matrix self-verifies the normative contract against the accepted wayfinding decisions and immutable prototype sources. No blocking discrepancy or ambiguous authority remains. Delivery tickets and executable tests do not exist yet; their links belong in the final column when created and must cite requirement IDs rather than copy requirements.

## Source register

<!-- prettier-ignore -->
| Name | Immutable source | Role |
|---|---|---|
| Codex desktop baseline | [Establish the current Codex desktop reference baseline](https://github.com/samanthar0se/Pidex/issues/60#issuecomment-5028086186) and [`docs/research/codex-desktop-reference-baseline.md`](../research/codex-desktop-reference-baseline.md) | Named desktop reference states and evidence gaps |
| Fidelity boundary | [Decide Pidex's Codex fidelity boundary](https://github.com/samanthar0se/Pidex/issues/61#issuecomment-5028164987) | Copy/adapt/distinct boundary |
| State inventory | [Define the core daily-loop state inventory](https://github.com/samanthar0se/Pidex/issues/62#issuecomment-5028079681) | Journeys, deltas, fixtures, recognition facts |
| Discovery prototype | [`a3ee97b`](https://github.com/samanthar0se/Pidex/tree/a3ee97bf64ab880ce2be0551128c91e9fe1e19df/.scratch/pidex-product-and-architecture/prototypes/session-discovery-new-session) | Selected Variant D and complete discovery scenarios |
| Discovery decision | [Decide Session discovery and New Session flow](https://github.com/samanthar0se/Pidex/issues/63#issuecomment-5028541010) | Discovery, routing, scope, creation |
| Timeline decision | [Decide how the Session Timeline presents live work](https://github.com/samanthar0se/Pidex/issues/64#issuecomment-5030087455) | Narrative, activity, paging, assistant-ui seam |
| Timeline renderer | [`pi-tin@0db15d6`](https://github.com/samanthar0se/pi-tin/tree/0db15d6ad0ee94f29ff66d68ee9e192302409953/apps/desktop/src/components/assistant-ui) | Existing Codex-like Timeline implementation |
| Composer prototype | [`2357ad8`](https://github.com/samanthar0se/Pidex/tree/2357ad862a2befe02a22c8a6f4f926e8824799b1/.scratch/pidex-product-and-architecture/prototypes/composer-run-controls) | Selected Variant D and command states |
| Composer decision | [Decide Composer and Run-control behavior](https://github.com/samanthar0se/Pidex/issues/65#issuecomment-5030158850) | Draft, steering, Stop, held work |
| Interaction prototype | [`953dd09`](https://github.com/samanthar0se/Pidex/tree/953dd09a9f18086a8cb7df1f7f21ea4aa1bd3a2e/.scratch/pidex-product-and-architecture/prototypes/open-interactions) | Selected Variant B and races |
| Interaction decision | [Decide how open Interactions fit the core workflow](https://github.com/samanthar0se/Pidex/issues/66#issuecomment-5032661186) | Takeover, ordering, reconciliation, privacy |
| Mobile prototype | [`d26ec68`](https://github.com/samanthar0se/Pidex/tree/d26ec688ebcfd1474ce22496af4b7a4f6bfccd3a/.scratch/pidex-product-and-architecture/prototypes/responsive-mobile-adaptation) | Selected Variant A and narrow scenarios |
| Mobile decision | [Decide the responsive mobile adaptation](https://github.com/samanthar0se/Pidex/issues/67#issuecomment-5033452747) | Drawer, header, dock, viewport behavior |
| Quality gate | [Define the frontend experience quality bar](https://github.com/samanthar0se/Pidex/issues/68#issuecomment-5033611051) | Responsive, focus, visual, motion, performance, recognition |
| Implementation strategy | [Choose the production frontend implementation strategy](https://github.com/samanthar0se/Pidex/issues/69#issuecomment-5033806457) | Stack, modules, testing, delivery |
| Package decision | [Define the consolidated frontend experience specification](https://github.com/samanthar0se/Pidex/issues/135#issuecomment-5033900634) | Canonical artifact and review gate |

## Canonical journeys and state deltas

<!-- prettier-ignore -->
| Journey | Required authoritative delta | Evidence coverage |
|---|---|---|
| Discover and resume | cache/no cache; connecting/current; grouped, searched, empty, archived; attention × read; selection without wake | Discovery Variant D scenarios; desktop and constrained captures; `FX-STATE-*`, `FX-DISC-*`, `FX-TRUST-*` |
| Create and start | local blank View; scope/capability/draft variants; create then Run; reject, partial success, uncertainty, wake/execution | Discovery Variant D `new-session`, scope, draft-failure, capability-absent, rejected, first-Run-rejected, transport-uncertain, offline; `FX-DISC-07`–`10` |
| Work and settle | bounded/reconciling Timeline; mutable tail; tool facts; paging; steer/Stop; command phases; terminal and held Runs | PiRemote Timeline fixture; Composer Variant D `quiet`, `executing`, `held`, `offline`, `uncertain`; `FX-TL-*`, `FX-COMP-*` |
| Resolve Interactions | none/one/several; four kinds; deadline order; pending and terminal states; another-Device/Stop/worker-loss races | Interaction Variant B, including competing-Device simulation; mobile `interactions`; `FX-INT-*` |
| Recover continuity | `current → offline → reconnecting → current`; stale/no-cache; disabled mutations; uncertain receipt; Interrupted and held work; terminal connection states | Discovery offline and Composer offline/uncertain scenarios; mobile offline prototype state; `FX-TRUST-*`, `FX-COMP-05`–`06` |

Cross-cutting review includes initial/incremental loading, empty/no-result/error, stale facts, capability-gated controls, archive/restore, long names and paths, dense content, multiple requests, short viewports, and authoritative replacement of local pending overlays. The selected prototypes preserve the shared Pidex fixture identities, including **Reconnect receipt race**, **Release pipeline review**, **Index corruption diagnosis**, and **PWA cache boundaries**.

## Essential handoff captures

These checked-in captures are orientation aids. Their immutable source pages above remain the complete evidence.

<!-- prettier-ignore -->
| Capture | Class and named state | Immutable source |
|---|---|---|
| [Discovery desktop](evidence/discovery-desktop.png) | Desktop · Variant D populated discovery | [`a3ee97b?variant=D&scenario=default`](https://raw.githack.com/samanthar0se/Pidex/a3ee97bf64ab880ce2be0551128c91e9fe1e19df/.scratch/pidex-product-and-architecture/prototypes/session-discovery-new-session/index.html?variant=D&scenario=default) |
| [New Session desktop](evidence/new-session-desktop.png) | Desktop · Variant D blank New Session | [`a3ee97b?variant=D&scenario=new-session`](https://raw.githack.com/samanthar0se/Pidex/a3ee97bf64ab880ce2be0551128c91e9fe1e19df/.scratch/pidex-product-and-architecture/prototypes/session-discovery-new-session/index.html?variant=D&scenario=new-session) |
| [Discovery constrained](evidence/discovery-constrained.png) | Constrained 900 × 900 · Variant D discovery | [`a3ee97b?variant=D&scenario=default`](https://raw.githack.com/samanthar0se/Pidex/a3ee97bf64ab880ce2be0551128c91e9fe1e19df/.scratch/pidex-product-and-architecture/prototypes/session-discovery-new-session/index.html?variant=D&scenario=default) |
| [Composer executing](evidence/composer-executing-desktop.png) | Desktop · Variant D executing exact-target controls | [`2357ad8?variant=D&state=executing`](https://raw.githack.com/samanthar0se/Pidex/2357ad862a2befe02a22c8a6f4f926e8824799b1/.scratch/pidex-product-and-architecture/prototypes/composer-run-controls/index.html?variant=D&state=executing) |
| [Interaction stack](evidence/interactions-desktop.png) | Desktop · Variant B compact stack | [`953dd09?variant=B`](https://raw.githack.com/samanthar0se/Pidex/953dd09a9f18086a8cb7df1f7f21ea4aa1bd3a2e/.scratch/pidex-product-and-architecture/prototypes/open-interactions/index.html?variant=B) |
| [Mobile working](evidence/mobile-working.png) | Narrow 500 × 900 · Variant A working | [`d26ec68?variant=A&scenario=working`](https://raw.githack.com/samanthar0se/Pidex/d26ec688ebcfd1474ce22496af4b7a4f6bfccd3a/.scratch/pidex-product-and-architecture/prototypes/responsive-mobile-adaptation/index.html?variant=A&scenario=working) |
| [Mobile Interactions](evidence/mobile-interactions.png) | Narrow 500 × 900 · Variant A interactions | [`d26ec68?variant=A&scenario=interactions`](https://raw.githack.com/samanthar0se/Pidex/d26ec688ebcfd1474ce22496af4b7a4f6bfccd3a/.scratch/pidex-product-and-architecture/prototypes/responsive-mobile-adaptation/index.html?variant=A&scenario=interactions) |

## Readiness matrix

`D`, `C`, and `M` mean desktop, constrained width, and narrow mobile. “All” requires applicable coverage at all three classes. Delivery links are intentionally `—` until sequencing creates implementation tickets.

<!-- prettier-ignore -->
| Requirement IDs | Decision provenance | Journey / required state delta | Prototype, capture, or non-visual rationale | Responsive | Codex reference / Pidex deviation | Keyboard, motion, performance, recognition evidence | Status | Delivery/tests |
|---|---|---|---|---|---|---|---|---|
| `FX-FOUND-01`–`02` | State inventory; package decision | All; exact fact vocabulary | Non-visual authority rule; `CONTEXT.md` glossary | All | Pidex language intentionally replaces Codex terms | Recognition uses exact facts, never aggregate Session state | Ready | — |
| `FX-STATE-01`–`05` | State inventory; fidelity boundary | Discover, work, resolve, recover; attention/read/current/target/draft deltas | Discovery and Composer complete scenario menus | All | Calm Codex rows; Pidex adds persistent actionable and trust exceptions | Recognition items 2–6; exact controls keyboard-reachable | Ready | — |
| `FX-DISC-01`–`04` | Discovery decision | Discover; populated/empty, attention × read, expansion/order | [Discovery desktop](evidence/discovery-desktop.png), [constrained](evidence/discovery-constrained.png) | D/C; drawer equivalent M | Direct Codex shell/row rhythm; Projects + Chats is Pidex hierarchy | `Ctrl+K`, row arrows, visible focus; one-frame selection feedback | Ready | — |
| `FX-DISC-05`–`06` | Discovery decision | Discover; search/no result/archive/restore/routing/no wake | Discovery Variant D scenario menu | All | Search stays in calm rail; Pidex Archive lifecycle is not a Codex claim | Search clear/return and route focus contract; current Session recognizable | Ready | — |
| `FX-DISC-07`–`10` | Discovery decision | Create; scope, capability, draft, rejection/partial success/uncertainty | [New Session](evidence/new-session-desktop.png) and Variant D state menu | All | Codex-like centered blank Composer; Pidex separates create and Run authority | Submit/newline/IME, validation focus, draft continuity, command-phase recognition | Ready | — |
| `FX-TL-01`–`05` | Timeline decision | Work/resolve; normal, streaming, tool, terminal, Interaction facts | Immutable PiRemote renderer and fixture; visual capture omitted because existing implementation is canonical | All | Closest available Codex-like narrative; Pidex removes split pane and keeps exact facts | Disclosure keyboard semantics; restrained motion; work/action/outcome recognition | Ready | — |
| `FX-TL-06`–`07` | Timeline decision | Work; older page, errors, mutable tail, reading upward | Non-visual behavioral contract grounded in PiRemote thread primitives and Host cursor paging | All | Pidex cursor authority, not Codex backend behavior | Anchor preservation, explicit fallback, no forced focus; stable loading | Ready | — |
| `FX-COMP-01`–`04` | Composer decision | Create/work; quiet, executing, steering, settled | [Composer executing](evidence/composer-executing-desktop.png), Variant D states | All | Codex-like persistent Composer; implicit steering and exact Stop are Pidex semantics | Enter/Shift+Enter/IME; one-frame acknowledgment; exact target recognizable | Ready | — |
| `FX-COMP-05`–`06` | Composer decision | Work/recover; held, offline, pending/rejected/uncertain | Composer Variant D `held`, `offline`, `uncertain` | All | Pidex authority deviation | Release/Cancel tab order; command phase and next action recognizable | Ready | — |
| `FX-INT-01`–`03` | Interaction decision | Resolve; one/several, draft empty/non-empty, takeover/return | [Interaction stack](evidence/interactions-desktop.png), [mobile](evidence/mobile-interactions.png) | All | Codex control tokens only; layout is intentionally Pidex due evidence gap | Deterministic takeover/return focus; short interruptible swap motion | Ready | — |
| `FX-INT-04`–`07` | Interaction decision | Resolve; pending, competing Device, deadline, withdrawal, Stop, privacy | Variant B competing-Device simulation; non-visual privacy rule | All | Pidex exact Interaction model | Pending row focus, next-request focus, exact target/result/next action recognizable | Ready | — |
| `FX-RESP-01`–`03` | Quality gate; mobile decision | All; long/dense/short/keyboard/safe-area/orientation stress | Desktop, constrained, and narrow capture set plus complete prototype state menus | All | Desktop parity only; constrained adaptation preserves hierarchy | No hidden primary action; anchor and focus preserved under pressure | Ready | — |
| `FX-RESP-04`–`07` | Mobile decision | Discover/work/resolve/recover on narrow Client | [Mobile working](evidence/mobile-working.png), [mobile Interactions](evidence/mobile-interactions.png), prototype offline/drawer/held scenarios | M | Explicit Pidex adaptation; no Codex-mobile claim | Touch-safe visible Stop/action/trust; dock continuity; functional drawer motion | Ready | — |
| `FX-TRUST-01`–`05` | Fidelity boundary; state inventory; mobile decision | Recover; all connection and uncertain-receipt deltas | Discovery offline, Composer offline/uncertain, mobile offline prototype state | All | Quiet current Codex shell; Pidex escalates non-current authority | Connection does not steal focus; stale/time/disabled reason/receipt phase recognizable | Ready | — |
| `FX-KEY-01`–`05` | Quality gate; consolidated contract | All; complete traversal and focus restoration | Non-visual normative keyboard map, exercised by each journey fixture during delivery | All | Product correctness, not a Codex or WCAG claim | Contract is complete; no Stop shortcut avoids ambiguous exact target | Ready | — |
| `FX-VIS-01`–`02` | Codex baseline; fidelity boundary | Discover/create/work representative desktop states | Desktop capture set and named first-party references in research note | D/C | Review geometry, type, density, color, border, control, icon, hierarchy; every deviation named | State-recognition overlay remains compatible with calm rhythm | Ready | — |
| `FX-QUAL-01`–`04` | Quality gate | All; transitions, waits, loading, recognition | Prototype transitions and complete recognition checklist; numerical budgets from `performance-budgets.ts` | All | Restrained Codex rhythm; Pidex state clarity has priority | Motion interruptible; input one frame; p95 budgets explicit; seven recognition questions | Ready | — |
| `FX-ARCH-01`–`04` | Implementation strategy; Timeline decision | All; production seams | Non-visual architecture decision; PiRemote implementation validates assistant-ui/store seam | All | Stack enables fidelity without importing Codex authority | Feature interfaces are test seams; exact authority remains inspectable | Ready | — |
| `FX-ARCH-05`–`06` | Implementation strategy | All; delivery evidence and PWA lifecycle | Non-visual layered test/build contract | All | Screenshot review, not brittle pixel diffs | Vitest/RTL/Playwright/Host suites plus owned service-worker invariants | Ready | — |

## Codex reference review

Desktop implementation must compare against the first-party named states in `docs/research/codex-desktop-reference-baseline.md`: empty/new work, populated discovery, executing/live work, and completed/reviewable output. Questions/approvals, disconnected treatment, and mobile layout are acknowledged evidence gaps. Pidex therefore copies visual tokens but uses its resolved Interaction, trust, and responsive structures rather than claiming undocumented Codex behavior.

Material deviations already accepted are: Pidex terminology and exact authority; Projects + Chats discovery; no suggestion cards; no split pane; pinned/reversible Pidex Interaction stack; exact-target Stop and command outcomes; explicit stale/trust treatment; and mobile as a Pidex adaptation.

## Self-review checklist

- [x] Every normative requirement has a unique stable ID and provenance.
- [x] Every requirement has a prototype/capture link or an explicit non-visual rationale.
- [x] Five canonical journeys and required state deltas are covered.
- [x] Desktop, constrained-width, and narrow-mobile classes plus pressure variants are specified.
- [x] Keyboard, focus, motion, perceived performance, Codex fidelity, and state recognition are complete.
- [x] No blocking discrepancy, contradiction, placeholder, or ambiguous authority remains.
- [x] Canonical Pidex terminology is used; “Chats” remains only a presentation label.
- [x] Immutable issue, commit, prototype, capture-source, and implementation-source links are pinned.
- [x] Essential checked-in captures name and link their immutable source states.
- [x] Delivery tickets and tests are intentionally absent until sequencing and will cite IDs and matrix rows.
