# Pidex Frontend Experience Contract

## Status and authority

This package is the normative implementation contract for Pidex's core daily coding loop. Requirement IDs are stable downstream references and must not be recycled after delivery tickets cite them. [Review evidence](review-evidence.md) records provenance and acceptance coverage; it may gain delivery links and refreshed captures but cannot contradict this file.

The accepted issue resolutions and immutable prototypes linked from the evidence matrix are source context, not competing specifications. `.scratch/pidex-product-and-architecture/SPEC.md`, prototype branches, and issue comments do not override this package. Resolve any conflict here before implementation proceeds.

## Destination and scope

Pidex will replace its current PWA with a responsive, Codex-like Client for the core loop: shell, Session discovery, New Session, Session Timeline, Composer and Run controls, open Interactions, responsive mobile behavior, and essential connection state.

The experience closely follows directly evidenced Codex desktop structure and visual rhythm while preserving Pidex authority and language. It does not include a split review pane, Codex feature parity or terminology, administrative surfaces, native packaging, backend redesign, or accessibility-specific features beyond keyboard and focus correctness already required by the core workflows.

## Experience invariants

- **FX-FOUND-01:** Use canonical Pidex language: Host, Device, Client, View, Project, Workspace, Session, Session Timeline, Composer Draft, Run, and Interaction. “Chats” is only the discovery label for unscoped Sessions.
- **FX-FOUND-02:** Render exact retention, residency, Run, Interaction, View, connection, and command facts. Never invent an aggregate Session lifecycle state or use “active” or “idle” as Session states.
- **FX-STATE-01:** Derive one discovery-only Session attention summary with precedence `needs response` over `working` over `quiet`. Quiet is normally implicit; exact facts remain in the selected Session View.
- **FX-STATE-02:** Keep Session read status independent of attention. A current View marks read only after visibly presenting the authoritative Timeline tail; cached or offline viewing cannot clear unseen Host activity.
- **FX-STATE-03:** Keep ordinary current/read/quiet state visually calm. Persistently expose `needs response`, held work, non-current authority, stale content, uncertain commands, and exact executing-Run/Stop state at their point of effect without hover.
- **FX-STATE-04:** Every action targets the exact observed Session, Run, Interaction, worker generation, and revision required by its command. A stale or competing result never retargets a successor.
- **FX-STATE-05:** Composer Drafts and Device preferences are Device-owned. Host facts, command outcomes, ordering, deadlines, and projections remain Host-authoritative.

## Shell, discovery, and New Session

- **FX-DISC-01:** Desktop uses one persistent, quiet discovery rail beside one focused, routable workbench. The main pane keeps generous readable whitespace and a bottom-anchored control surface.
- **FX-DISC-02:** Discovery shows stable Project accordions first, with Project-scoped Sessions directly beneath each Project, followed by flat unscoped Sessions under **Chats**. Never show a Workspace accordion or Workspace metadata in a discovery row.
- **FX-DISC-03:** Preserve authoritative Project order and order Sessions by recent authoritative activity. Remember Project expansion on the Device and automatically reveal the selected Session or a search match without mutating Session state.
- **FX-DISC-04:** Session rows combine quiet selection, restrained unread emphasis, and compact persistent `working` or `needs response` cues. They do not priority-sort or collapse attention and read status into one state.
- **FX-DISC-05:** Search filters the existing Projects + Chats hierarchy in place, may match hidden Workspace scope, hides nonmatches, and leaves the focused View intact on no results. Archived is a dedicated catalog mode with the same hierarchy; archived selection exposes reviewable content and Restore.
- **FX-DISC-06:** Session selection installs a stable resource URL and behaves with browser history, reload, and parallel tabs/windows. View lifecycle never wakes, sleeps, archives, restores, or stops a Session.
- **FX-DISC-07:** Global New Session opens an unscoped Client-local blank View. Project launch inherits only that Project. The blank View may add or change optional Workspace scope without replacing its draft, and exact scope remains visible above the Composer.
- **FX-DISC-08:** Runtime, model, and mode controls are capability-dependent: omit unsupported choices and disable temporarily unavailable choices with a reason.
- **FX-DISC-09:** The primary first-submit action creates the durable Session and accepts its initial Run as distinguishable Host operations. **Create empty Session** remains in the secondary Composer menu.
- **FX-DISC-10:** Creation rejection preserves scope and draft in the blank View. Creation success plus first-Run rejection selects the durable empty Session and retains the draft. Transport uncertainty preserves the draft, blocks unsafe duplicate submission, and reconciles before another Host mutation.

## Session Timeline

- **FX-TL-01:** Present each turn as restrained prompt, one turn-level `Working for…`/`Worked for…` disclosure with ordered progress and semantic tool activity, then an unboxed final answer. Completed work remains readable and inspectable.
- **FX-TL-02:** Keep normal Run boundaries, start/completion, lifecycle, recovery, and durable non-interactive Interaction facts in the quiet work disclosure. Keep `Failed`, `Cancelled`, and `Interrupted` outcomes visible outside a collapsed disclosure with restrained severity.
- **FX-TL-03:** Render live Interaction controls exactly once in the control dock, never in historical Timeline entries. Historical Interaction entries are durable, non-interactive facts.
- **FX-TL-04:** Project authoritative entries through a pure Pidex Timeline presentation module. Mutable entries update in place by stable identity and monotonic revision; finalized entries never rewrite, and corrections or recovery facts append.
- **FX-TL-05:** Tool activity preserves order and raw detail on demand. Consecutive shell calls may group; running and error detail opens automatically; completed detail may collapse.
- **FX-TL-06:** Begin with the Host's bounded recent window. Automatically fetch the previous cursor page near the top, preserve the exact visible anchor on prepend, show inline loading/error, and retain an explicit **Load older history** fallback.
- **FX-TL-07:** Follow mutable-tail updates only while near the bottom. Preserve reading position otherwise and expose a compact jump-to-latest control. Initial delivery does not require virtualization.

## Composer and Run controls

- **FX-COMP-01:** Use one persistent Composer Draft for new work, steering, and the next Run. `Enter` submits, `Shift+Enter` inserts a newline, and an active IME composition never submits.
- **FX-COMP-02:** During an executing Run, an empty draft makes the circular primary action exact-target **Stop**; typing changes it to **Send**, which implicitly steers that exact Run without explanatory mode chrome.
- **FX-COMP-03:** Pidex does not create a queued follow-up while a Run executes. After settlement, non-empty Send creates the next Run. Model and mode edits during execution configure that next Run; steering retains the executing Run's configuration.
- **FX-COMP-04:** Show only steering messages awaiting delivery above the Composer. Do not add ordinary executing or targeting explanation there.
- **FX-COMP-05:** Previously accepted follow-ups in recovery hold remain separate from the draft with explicit **Release** and **Cancel** actions. Never merge or replay them automatically.
- **FX-COMP-06:** Offline draft editing remains available. Disable Host mutations until reconciliation. Pending, accepted-awaiting-projection, rejected, and transport-uncertain outcomes remain visible in place and never invite a semantically new retry.

## Open Interactions

- **FX-INT-01:** An open Interaction adds a compact discovery cue and a durable Timeline fact. If the draft is empty and unfocused, the first newly open Interaction reversibly takes over the Composer footprint; otherwise it updates a cue without stealing focus.
- **FX-INT-02:** The takeover is a compact stack ordered by earliest authoritative Host deadline, then untimed creation order. Keep all requests scannable and one expanded with its exact `select`, `confirm`, `input`, or `editor` response shape, provenance, Run association, and illustrative countdown.
- **FX-INT-03:** **Write message** and **Return to requests** swap the stack and Composer in the same footprint while preserving the Device-owned draft. Never display both surfaces simultaneously.
- **FX-INT-04:** Submission or dismissal targets the exact Interaction identity, worker generation, and revision. Pending intent affects only that row; other requests remain navigable.
- **FX-INT-05:** A terminal Host change removes the row, expands the next Host-ordered request, or restores the Composer when none remain. A competing Device, deadline, withdrawal, or Stop clears local intent and states the authoritative result without replay or retargeting.
- **FX-INT-06:** Confirm and select values may appear in durable terminal facts. Input and editor plaintext must not enter Timeline content, receipts, diagnostics, logs, or Device caches.
- **FX-INT-07:** Exact-target Stop remains directly reachable in the Session header during takeover and withdraws only unresolved Interactions associated with its Run.

## Responsive behavior

- **FX-RESP-01:** Validate the five canonical journeys at desktop, constrained width, and narrow mobile, including long names and paths, dense Timeline and Interaction content, short viewports, mobile keyboard, safe-area insets, and orientation changes.
- **FX-RESP-02:** At every class, primary content and actions remain readable, reachable, unclipped, and free of required horizontal scrolling, hover, or hidden gestures.
- **FX-RESP-03:** Constrained width preserves the desktop information hierarchy while reducing whitespace, truncating secondary context accessibly, and moving secondary actions into overflow before primary actions collapse.
- **FX-RESP-04:** Narrow mobile turns discovery into a full-height slide-over drawer opened from the sticky Session header. Selection closes it and installs the routable View without changing Session lifecycle.
- **FX-RESP-05:** The mobile header contains drawer trigger, truncated Session title, quiet exact Project/Workspace context, directly reachable exact-target Stop while executing, and overflow for secondary actions. It has no persistent Run/status shelf.
- **FX-RESP-06:** Mobile uses one bounded, safe-area-aware bottom dock for Composer, Interaction stack, or held-work controls. Keep it above the visual keyboard and preserve the visible Timeline anchor across keyboard and orientation changes.
- **FX-RESP-07:** When non-current on mobile, show a persistent row immediately below the header with exact connection state and last authoritative synchronization time; the drawer footer is not sufficient.

## Connection and trust

- **FX-TRUST-01:** Represent connection as `current`, `offline`, `reconnecting`, `update required`, or `revoked`. Non-current scopes show last authoritative synchronization time and unmistakable stale treatment.
- **FX-TRUST-02:** Cached discovery, Run, Interaction, output, warning, countdown, capability, and read-state facts never appear current. A no-cache offline shell explains that authoritative content is unavailable.
- **FX-TRUST-03:** Disable every Host mutation until required scopes reconcile under a compatible basis. Preserve valid Device-local draft editing and never queue offline commands.
- **FX-TRUST-04:** Transport-uncertain commands reconcile the original Command ID and validity context to accepted, rejected, expired, or indeterminate; they never change content, target, preconditions, or identity.
- **FX-TRUST-05:** Update-required and revoked are terminal treatments. Reconnection verifies origin, Host identity, Device authorization, and protocol basis before current controls return.

## Keyboard and focus contract

- **FX-KEY-01:** `Tab` and `Shift+Tab` traverse visible controls in DOM order; `Enter` and `Space` activate controls; `Escape` closes the topmost drawer, menu, disclosure, or temporary mode and returns focus to its invoker. Every focus indicator is visible and no surface traps focus.
- **FX-KEY-02:** `Ctrl+K` focuses discovery search. Up/Down moves among visible Project and Session rows; Right expands a Project; Left collapses it or returns to its Project; `Enter` selects; `Escape` clears search first, then returns focus to the selected Session row.
- **FX-KEY-03:** Pidex defines no global Stop shortcut for this scope. Stop is keyboard-reachable through the exact-target visible control so a stale View cannot trigger an implicit target.
- **FX-KEY-04:** Session navigation focuses the Session heading without forcing Timeline scroll. Opening a drawer or menu focuses its first meaningful control; closing restores its invoker. Interaction takeover focuses its heading only when takeover was allowed to replace an empty, unfocused draft; return restores the prior Composer selection.
- **FX-KEY-05:** Authoritative Interaction removal moves focus to the next expanded request, or to the Composer when none remain. Validation or command failure focuses the inline summary while retaining input. Connection changes announce treatment but do not steal focus; controls disabled by the change remain explainable adjacent to their former action.

## Visual fidelity, motion, and performance

- **FX-VIS-01:** Desktop follows named Codex evidence for persistent quiet rail, focused workbench, broad bottom Composer, neutral light/dark surfaces, thin low-contrast separators, soft rounded selection, muted metadata, compact icon rhythm, restrained accents, and generous narrative whitespace.
- **FX-VIS-02:** Review shell geometry, composition, typography, spacing, density, color, borders, control geometry, icon weight, and narrative hierarchy side by side. Document every material deviation as Pidex semantics, explicit scope, or an evidence gap. Mobile makes no Codex parity claim.
- **FX-QUAL-01:** Motion is short, functional, interruptible, and limited to spatial or state continuity such as drawer, disclosure, takeover, and reconciliation. Superseding state reaches its correct end immediately; streaming does not create decorative churn or layout instability.
- **FX-QUAL-02:** Preserve shell and useful prior content through waits. Acknowledge input within one rendered frame; use stable state-specific pending, streaming, paging, offline, and reconnecting treatment without avoidable layout jumps.
- **FX-QUAL-03:** Meet existing measured p95 budgets: cold shell 3000 ms, warm shell 1000 ms, cached Session 300 ms, uncached recent Session 2000 ms, command outcome 250 ms, authoritative reconciliation 500 ms, live output after Host receipt 250 ms, and resumable reconnect 3000 ms.
- **FX-QUAL-04:** Every canonical frame must make recognizable, where applicable: current Session and scope; current versus stale authority and last sync; work in progress; required user action; exact target; command phase; and available next action.

## Production frontend seams

- **FX-ARCH-01:** Replace the current frontend directly with a client-rendered React 19, strict TypeScript, Vite, Zustand, Tailwind 4, Lucide, Inter, JetBrains Mono, `@assistant-ui/react`, and `@assistant-ui/react-markdown` application. Do not introduce SSR, React islands, or a legacy compatibility route.
- **FX-ARCH-02:** Use one Pidex-owned Zustand store as the React state and command interface. Private adapters supply transport, IndexedDB, clock/identity, routing lifecycle, and service-worker state. React consumes narrow selectors and typed intents, never raw WebSocket or IndexedDB operations.
- **FX-ARCH-03:** Keep assistant-ui strategic but subordinate to Pidex authority. Pidex owns identity, order, revisions, finalization, Run association, paging, cached/current state, Interactions, commands, and read-through; assistant-ui supplies compatible thread, message, Markdown, Composer, action, and scrolling primitives.
- **FX-ARCH-04:** Organize `apps/pwa` by product feature: bootstrap/composition; deep Client store and private adapters; discovery/Archived; New Session; responsive shell/header; Timeline projection/runtime; Composer/Run controls; Interactions/held work; connection/trust; and a small owned token/primitive layer.
- **FX-ARCH-05:** Use Vitest for pure transitions and projections, React Testing Library for focused feature composition and focus behavior, Playwright for canonical responsive journeys and captures, and a small real-Host suite for protocol, synchronization, command delivery, routing, assets, and service-worker/update integration.
- **FX-ARCH-06:** Vite emits hashed assets and a generated manifest consumed by the Host. Retain a Pidex-owned service worker with complete-generation, saved-draft, explicit-reload, and multiple-Client refusal invariants.

## Implementation readiness

Delivery sequencing may begin only when every requirement has provenance and evidence or an explicit non-visual rationale in `review-evidence.md`; all links resolve; no blocking discrepancy, contradiction, placeholder, or ambiguous authority remains; canonical language is consistent; responsive, keyboard/focus, trust, command-race, and recognition coverage is complete; and checked-in captures match their pinned prototype sources.
