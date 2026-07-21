# Codex Desktop Reference Baseline for Pidex

## Research question

Which observable structures, interaction patterns, visual rules, and representative states in the current Codex desktop app should form the evidence baseline for Pidex's core daily-loop experience?

## Executive summary

The current reference is **Codex inside the ChatGPT desktop app**, not an independently stable “Codex desktop app.” OpenAI's current release material says that Codex joined the ChatGPT desktop app on macOS and Windows on July 9, 2026; the current app keeps Codex beside Chat and Work modes. [S1](https://learn.chatgpt.com/docs/whats-new#use-codex-in-the-chatgpt-desktop-app) [S2](https://learn.chatgpt.com/docs/app)

The evidence baseline for Pidex should therefore be the quiet workbench pattern:

1. A persistent discovery rail for starting work and finding recent work, with projects and history visible without leaving the work surface.
2. One focused Session View in the main pane, with scope/location context at the top and a readable work history or live work narrative in the middle.
3. A large, calm Composer anchored to the bottom, with scope, execution location, model/mode choices, and a single obvious submit/run affordance.
4. Live work that remains legible as it progresses: concise assistant updates, inspectable tool/output artifacts, visible progress controls, and a clear path to follow up without losing context.
5. Explicit attention states for questions, approvals, completion, and blocking, while keeping the exact Pidex Interaction model authoritative.
6. A light/dark visual system built from neutral surfaces, thin separators, restrained accents, rounded selection and composer surfaces, compact utility controls, and generous main-content spacing.
7. Mobile continuity as a separate responsive observation target, not as an assumed copy of the desktop shell. First-party material establishes mobile Remote access and prompt/approval/follow-up continuity, but does not establish the exact mobile Codex layout.

The current Pidex direction already captures most of this structure in SPEC section 10 and the selected responsive prototype variant. The main evidence gap is not the shell; it is the exact current presentation of live controls, questions/approvals, offline/reconnecting states, and mobile behavior. Those states should be re-observed against the installed app before implementation polish is finalized. [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L397-L438) [L2](../../.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/README.md#L3-L11)

## Evidence boundary and access log

- **Research date:** 2026-07-20 UTC.
- **Primary published material:** OpenAI's current ChatGPT Learn Codex pages and first-party image assets, accessed on the research date. These pages are mutable; page content and images are not treated as version-pinned UI contracts. [S1](https://learn.chatgpt.com/docs/app) [S2](https://learn.chatgpt.com/docs) [S3](https://learn.chatgpt.com/docs/quickstart)
- **Installed first-party package:** Windows package `OpenAI.Codex` version `26.715.7063.0`, status `Ok`, from `C:\Program Files\WindowsApps\OpenAI.Codex_26.715.7063.0_x64__2p2nqsd0c76g0\AppxManifest.xml`. This confirms an accessible current Windows package, but is an environment/version observation rather than a published UI contract. [E1](C:\Program%20Files\WindowsApps\OpenAI.Codex_26.715.7063.0_x64__2p2nqsd0c76g0\AppxManifest.xml)
- **Direct live-app limit:** An authenticated interactive walkthrough of the installed app was not completed in this research pass. No inaccessible approval, failure, or mobile state is presented as observed. The visual observations below come from first-party published assets; behavioral observations come from first-party documentation.
- **Platform limit:** The installed package is Windows x64. The official app documentation describes the desktop surface for Windows and macOS, while mobile evidence describes ChatGPT Remote rather than a standalone mobile Codex client. [S3](https://learn.chatgpt.com/docs/quickstart) [S7](https://learn.chatgpt.com/docs/remote-connections)

## Direct observations

### 1. Shell and discovery

The current first-party app illustration shows a persistent left rail and a single dominant content surface. The rail includes a primary new-work action, search/history navigation, project or folder grouping, and recent chat rows with relative times. The published active-work asset shows the same pattern with `New thread`, secondary destinations, project folders, pinned work, and a `Threads` section containing named work items. [S1](https://learn.chatgpt.com/docs/app) [S2](https://learn.chatgpt.com/docs)

The rail is a discovery surface, not a supervision dashboard. It makes parallel work findable through projects, pinned work, and recency, while the selected work remains the visual focus. The current overview also shows additional destinations such as Scheduled, Plugins, Sites, and Pull requests. Those are observable current product surfaces, but they are not required evidence for Pidex's core Session loop and should not expand the v1 baseline. [S1](https://learn.chatgpt.com/docs/app) [S2](https://learn.chatgpt.com/docs)

**Pidex translation:** keep one persistent discovery sidebar, but use `New Session`, `Archived`, Project/Workspace grouping, Session rows, and compact Session state cues. Do not import “thread,” Codex product navigation, or unrelated destinations into Pidex copy. This preserves the explicit constraint in issue 59 and the canonical vocabulary in the local specification. [S8](https://github.com/samanthar0se/Pidex/issues/59) [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L399-L416)

### 2. New work and the Composer

The official desktop quickstart describes a short path: install and sign in, choose where the app should work by starting a chat, creating a project, or opening a folder, then send a first message. In the Codex surface, the documented starting point is `New chat`; a quick-chat affordance is placed on that row for a short question. The same documentation tells the user to describe the desired result and add files or context. [S3](https://learn.chatgpt.com/docs/quickstart)

The first-party empty-state illustration makes the visual shape concrete: a centered prompt such as “What should we build?”, a small set of task suggestion cards, and a broad Composer below. The Composer visibly carries project selection, branch selection, local execution location, effort/model context, optional input affordances, and a single send arrow. [S2](https://learn.chatgpt.com/docs)

The active-work asset shows the Composer reduced to a quiet bottom control surface with a placeholder for follow-up changes, an add control, code/model/reasoning selectors, a lock and microphone affordance, and a send arrow. Its footer discloses `Local` and the current branch. [S1](https://learn.chatgpt.com/images/codex/app/codex-app-light.webp) [S1-dark](https://learn.chatgpt.com/images/codex/app/codex-app-dark.webp)

**Pidex translation:** `New Session` should open a Client-local blank View and Composer Draft; Project and Workspace are Pidex scope selectors; the first submit creates the Session and accepts the initial Run as separate Host operations. While a Run executes, the Composer remains available for exact-target steering or an ordered follow-up where the negotiated capability permits it. This is a Pidex domain decision, not an assumption about Codex internals. [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L424-L426) [L3](../../.scratch/pidex-product-and-architecture/SPEC.md#L868-L891)

### 3. Timeline, live work, and reviewable output

The published active-work state shows a focused work narrative on the left and a reviewable change surface on the right. The narrative contains short progress updates, code-formatted tokens, bullet lists, validation notes, links, and a follow-up Composer. The adjacent change surface contains changed-file headers, line-numbered diffs, additions/deletions, and an inline comment field. Top controls expose run/open/commit context and change counts. [S1](https://learn.chatgpt.com/images/codex/app/codex-app-light.webp)

This establishes an important experience rule: completed or in-progress work is not reduced to a spinner. The user can read what happened, inspect concrete output, and continue from the same work item. The app page describes the desktop app as a place to run projects in parallel, work with files, inspect outputs, use tools, and keep long-running work moving from one desktop workspace. [S1](https://learn.chatgpt.com/docs/app)

OpenAI's long-running-work guidance adds a documented live-work pattern: `/goal` creates a goal with completion criteria; a progress row appears above the Composer and can pause, resume, edit, or clear the goal; follow-up messages can add context or adjust constraints; and a side chat can request a status recap without interrupting the main work. [S4](https://learn.chatgpt.com/docs/long-running-work)

**Pidex translation:** render the Host-owned Session Timeline as the durable narrative of prompts, output, tool activity, Interactions, Run boundaries, and recovery facts. Render mutable output as an updating tail, but do not make token-by-token animation the contract. Preserve an always-available Composer and exact-target Run controls. The current Pidex specification explicitly makes this Timeline and authority boundary stronger than any Pi history format. [L4](../../.scratch/pidex-product-and-architecture/SPEC.md#L312-L316) [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L414-L416)

The right-side diff/review panel is **directly evidenced but not automatically a Pidex v1 requirement**. Pidex SPEC section 10 explicitly excludes split view; therefore the baseline should adopt the evidence rule—make outputs inspectable and reviewable—without importing a Codex split-pane feature that the local product decision excludes. [S1](https://learn.chatgpt.com/images/codex/app/codex-app-light.webp) [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L414-L416)

### 4. Visual rhythm and rules

Across the first-party light and dark active-work assets and the light empty-state illustration, the stable visual rules are:

- a quiet neutral shell with a slightly contrasting discovery rail;
- thin, low-contrast separators rather than heavy panels;
- a selected history row shown by a soft rounded surface, not a loud accent block;
- compact, icon-led utility controls close to the work surface edges;
- generous whitespace around the central narrative and readable line length;
- rounded Composer and suggestion surfaces with restrained shadow and border treatment;
- small muted metadata for project, branch, location, and recency; and
- equivalent information hierarchy in light and dark themes, with accents reserved for action, status, or change semantics. [S1](https://learn.chatgpt.com/images/codex/app/codex-app-light.webp) [S1-dark](https://learn.chatgpt.com/images/codex/app/codex-app-dark.webp) [S2](https://learn.chatgpt.com/docs)

The implication is a focused workbench, not a metrics board: discovery is dense and quiet; the Session Timeline is spacious; the Composer is visually persistent; and execution context is visible without competing with the work. This is an inference from the repeated published compositions, not a claim about private design tokens. [S1](https://learn.chatgpt.com/docs/app) [S2](https://learn.chatgpt.com/docs)

### 5. Questions, approvals, and attention

First-party documentation confirms that the desktop surface distinguishes at least three attention categories for notification purposes: turn completion, permission requests, and questions. It also documents visible work states as `Running`, `Needs input`, `Ready`, and `Blocked` for the desktop pet. [S5](https://learn.chatgpt.com/docs/notifications)

The permissions documentation distinguishes local permission profiles from approval policy and says that profiles define filesystem and network boundaries for local command execution. That is security/behavior documentation, not evidence for a particular inline card layout. [S6](https://learn.chatgpt.com/docs/permissions)

No first-party source inspected here provides enough visual evidence to claim the current exact layout, wording, ordering, or multi-request behavior of Codex's approval/question UI. The baseline should therefore specify the **observable need**—a Session row and focused Session View must make “needs input” or “blocked” unmistakable and actionable—without copying an unobserved Codex control.

**Pidex translation:** use the existing Host-owned `Interaction` model and present one live response area pinned above the still-available Composer. Keep the Timeline fact non-interactive, support `select`, `confirm`, `input`, and `editor` kinds, and retain terminal outcomes as durable Timeline facts. This is already the local product decision; the Codex evidence validates the attention requirement, not the Pidex state machine. [L5](../../.scratch/pidex-product-and-architecture/SPEC.md#L253-L265) [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L428-L432)

### 6. Connection and execution location

The official active-work asset places `Local` and the current branch in the lower Composer context, making execution location part of ordinary work rather than an administrative afterthought. [S1](https://learn.chatgpt.com/images/codex/app/codex-app-light.webp)

The current Remote documentation says that the connected host supplies projects, files, credentials, permissions, plugins, browser setup, and local tools. It also says that the user sends prompts, approvals, and follow-up messages from a phone; Remote work stops when the host sleeps, loses network access, or closes the app. [S7](https://learn.chatgpt.com/docs/remote-connections)

**Pidex translation:** show Host connection state, last authoritative synchronization time, Device identity, and the Session's Project/Workspace context in the normal shell. Keep execution location or Host scope visible near the Composer and Session header. Do not imply that an offline cached View is current or that a reconnect automatically submits a draft or command; those are explicit Pidex authority rules. [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L403-L414) [L6](../../.scratch/pidex-product-and-architecture/SPEC.md#L451-L467)

### 7. Responsive and mobile behavior

First-party material establishes that the ChatGPT mobile app can use Remote to access desktop Codex work on a connected Mac or Windows host, switch between connected hosts and chats, and send prompts, approvals, and follow-up messages. It also says the desktop host must be awake, online, and signed in, and that availability can vary by rollout. [S7](https://learn.chatgpt.com/docs/remote-connections)

That material does **not** establish the exact mobile Codex shell, drawer geometry, mobile Timeline layout, Composer keyboard treatment, or mobile approval card presentation. No such state is fabricated here.

**Pidex translation:** the local responsive prototype's selected direction—same hierarchy, slide-over Session drawer, Timeline and Composer remaining primary, overflow for secondary actions, and directly reachable Stop—is a Pidex design decision informed by the desktop shell, not a direct observation of Codex mobile. [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L434-L438) [L2](../../.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/README.md#L9-L11)

## Representative evidence states

| State | Evidence status | Baseline decision for Pidex |
|---|---|---|
| Empty/new work | **High.** First-party overview asset and quickstart show the new-work prompt, suggestions, project/location selection, and Composer. [S2](https://learn.chatgpt.com/docs) [S3](https://learn.chatgpt.com/docs/quickstart) | Baseline: blank Session View, Device-owned Composer Draft, scope selection, explicit empty Session or first Run path. |
| Populated discovery | **High.** First-party assets show projects, pinned items, recent work, folders, timestamps, and selected history rows. [S1](https://learn.chatgpt.com/docs/app) [S2](https://learn.chatgpt.com/docs) | Baseline: persistent Project/Workspace-grouped Session discovery with compact cues and recency. |
| Executing/live work | **Medium-high.** Active-work asset shows progress narrative and change output; long-running docs specify a progress row and pause/resume/edit/clear controls. [S1](https://learn.chatgpt.com/images/codex/app/codex-app-light.webp) [S4](https://learn.chatgpt.com/docs/long-running-work) | Baseline: readable live Timeline tail, exact-target Run controls, persistent Composer, and a visible progress/attention treatment. Re-observe exact control placement before polish. |
| Completed/reviewable work | **High for output review.** Published asset shows final narrative, validation notes, changed files, diff counts, and inline comment affordance. [S1](https://learn.chatgpt.com/images/codex/app/codex-app-light.webp) | Baseline: make completed Timeline and output facts inspectable. Do not add a split pane unless a later Pidex decision permits it. |
| Needs input / permission approval | **Low for visual layout; high for existence.** Notifications docs confirm questions and permission requests; no inspected source pins down the inline UI. [S5](https://learn.chatgpt.com/docs/notifications) [S6](https://learn.chatgpt.com/docs/permissions) | Baseline semantic state only: Session cue, pinned Interaction response area, non-interactive Timeline fact, exact Interaction identity. Re-observe current UI. |
| Blocked / host unavailable | **Low for Codex visual treatment.** First-party docs describe host availability requirements and `Blocked` attention status, but not the exact disconnected desktop composition. [S5](https://learn.chatgpt.com/docs/notifications) [S7](https://learn.chatgpt.com/docs/remote-connections) | Baseline using Pidex's explicit `offline`, `reconnecting`, `current`, `update required`, and `revoked` states with stale treatment and last sync. Re-observe only for visual polish. |
| Mobile continuation | **Medium for capability, low for layout.** Remote docs confirm prompts, approvals, follow-ups, host switching, and host availability; no exact mobile Codex layout is evidenced. [S7](https://learn.chatgpt.com/docs/remote-connections) | Baseline Pidex's responsive hierarchy and Device semantics; do not claim Codex-mobile visual parity. Re-observe before final mobile implementation. |
| Archived/restored work | **Not evidenced in inspected current desktop assets/docs.** | Keep Pidex Archive/Restore because it is a Pidex lifecycle requirement, not because Codex evidence establishes its UI. [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L403-L407) |

## What is stable enough to baseline

The following are supported by repeated first-party visual evidence or by both visual and documentation evidence:

- persistent discovery rail plus one focused main work surface;
- recent work organized around projects/folders and identifiable work items;
- a clear new-work entry point and a Composer that carries scope/location context;
- a spacious, readable work narrative with inspectable output rather than an opaque progress indicator;
- bottom-anchored Composer persistence, with live-work progress/control treatment above it where needed;
- neutral light/dark surfaces, low-contrast dividers, rounded selection/composer surfaces, muted metadata, and restrained accents;
- explicit execution location and enough connection context to know where work is running; and
- continuity of prompts, approvals, follow-ups, and long-running work across a desktop work surface and a connected Device, translated through Pidex authority rules. [S1](https://learn.chatgpt.com/docs/app) [S3](https://learn.chatgpt.com/docs/quickstart) [S4](https://learn.chatgpt.com/docs/long-running-work) [S7](https://learn.chatgpt.com/docs/remote-connections)

These rules align with the local Pidex structure: the specification names the sidebar/main-pane shell, Project/Workspace grouping, Timeline, Composer, pinned Interactions, connection state, and mobile hierarchy; the prototype's selected variant is explicitly the Codex-like baseline. [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L399-L438) [L2](../../.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/README.md#L3-L11)

## What must be re-observed before implementation

Re-observe the installed Windows app, and the current macOS app if available, for:

- the exact active-Run control row, including stop/pause/steer semantics and where it sits relative to the Composer;
- the current inline presentation of permission requests, questions, multiple simultaneous requests, expiry, dismissal, and blocked work;
- connection loss, reconnecting, stale content, host switching, and notification click-through;
- the current mobile Remote Session View, drawer/header behavior, keyboard-safe Composer, and mobile Interaction controls;
- whether the active change/review surface is still a split pane at the target release and how it collapses responsively;
- archive/history filtering and any current search affordance; and
- the current light/dark tokens, typography metrics, spacing, and motion timing if visual parity is required rather than structural parity.

These are intentionally open evidence questions. The official pages are mutable, the installed Windows package is version-specific, and no authenticated live walkthrough was completed. The implementation should not convert documentation nouns or a published screenshot into an unverified Codex backend contract.

## Local comparison context

- `.scratch/pidex-product-and-architecture/SPEC.md#L397-L438` already selects the persistent sidebar, focused Session pane, pinned Interaction area, connection state, and responsive drawer direction. [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L397-L438)
- `.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/README.md#L3-L11` records Variant A as the Codex-like structural baseline and provides offline/reconnecting and Interaction-placement comparisons. [L2](../../.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/README.md#L3-L11)
- `.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/index.html#L156-L207` records the selected prototype's light neutral rhythm, spacious Timeline, rounded Composer, and pinned Interaction treatment; `#L300-L322` records the mobile drawer and compact connection treatment. [L2](../../.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/index.html#L156-L207)
- `apps/pwa/index.html#L50-L145` and `#L253-L408` show the current production shell, fixed Composer, Timeline/Interaction regions, mobile drawer, and stale Host state styling. `apps/pwa/app.js#L688-L765` and `#L818-L1147` show Project/Workspace discovery, Session cues, Timeline rendering, Composer Draft behavior, Run controls, and Interaction controls. [L3](../../apps/pwa/index.html#L50-L145) [L3-css](../../apps/pwa/index.html#L253-L408) [L3-js](../../apps/pwa/app.js#L688-L765) [L3-interactions](../../apps/pwa/app.js#L818-L1147)
- `CONTEXT.md#L1-L43` remains unchanged by this research; its canonical Host, Device, and Pidex companion extension vocabulary is preserved. [L7](../../CONTEXT.md#L1-L43)

## Sources

- **S1 — Current ChatGPT desktop app page and first-party assets:** [ChatGPT desktop app](https://learn.chatgpt.com/docs/app), [light active-work asset](https://learn.chatgpt.com/images/codex/app/codex-app-light.webp), [dark active-work asset](https://learn.chatgpt.com/images/codex/app/codex-app-dark.webp). Accessed 2026-07-20 UTC.
- **S2 — Current Codex overview and first-party empty-state illustration:** [Codex overview](https://learn.chatgpt.com/docs), [overview wallpaper asset](https://learn.chatgpt.com/images/codex/codex-wallpaper-1.webp). Accessed 2026-07-20 UTC.
- **S3 — Official desktop quickstart:** [Codex quickstart](https://learn.chatgpt.com/docs/quickstart). Accessed 2026-07-20 UTC.
- **S4 — Official long-running work guidance:** [Long-running work](https://learn.chatgpt.com/docs/long-running-work). Accessed 2026-07-20 UTC.
- **S5 — Official notification states:** [Notifications](https://learn.chatgpt.com/docs/notifications). Accessed 2026-07-20 UTC.
- **S6 — Official permission guidance:** [Permissions](https://learn.chatgpt.com/docs/permissions). Accessed 2026-07-20 UTC.
- **S7 — Official Remote and mobile continuity guidance:** [Remote connections](https://learn.chatgpt.com/docs/remote-connections). Accessed 2026-07-20 UTC.
- **S8 — Official release material establishing the current desktop product boundary:** [What's new — Codex joins the ChatGPT desktop app](https://learn.chatgpt.com/docs/whats-new#use-codex-in-the-chatgpt-desktop-app). Accessed 2026-07-20 UTC; entry dated July 9, 2026.
- **E1 — Installed official Windows package observation:** `C:\Program Files\WindowsApps\OpenAI.Codex_26.715.7063.0_x64__2p2nqsd0c76g0\AppxManifest.xml`; package query reported `OpenAI.Codex`, version `26.715.7063.0`, status `Ok`, on 2026-07-20 UTC. This is an environment/version check, not a claim that the package exposes every documented state.
- **L1 — Pidex v1 information architecture:** `.scratch/pidex-product-and-architecture/SPEC.md#L397-L438`.
- **L2 — Pidex responsive prototype:** `.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/README.md#L3-L19` and `.scratch/pidex-product-and-architecture/prototypes/pwa-information-architecture/index.html#L156-L207`.
- **L3 — Current Pidex PWA context:** `apps/pwa/index.html#L50-L145`, `apps/pwa/index.html#L253-L408`, and `apps/pwa/app.js#L688-L765`, `apps/pwa/app.js#L818-L1147`.
- **L4 — Pidex Session Timeline model:** `.scratch/pidex-product-and-architecture/SPEC.md#L312-L316`.
- **L5 — Pidex Interaction model:** `.scratch/pidex-product-and-architecture/SPEC.md#L253-L265`.
- **L6 — Pidex offline/reconnect and draft rules:** `.scratch/pidex-product-and-architecture/SPEC.md#L451-L469`.
- **L7 — Pidex canonical vocabulary:** `CONTEXT.md#L1-L43`.
- **Issue 59 — scope and non-import constraints:** [Chart the Codex-like core frontend experience](https://github.com/samanthar0se/Pidex/issues/59). Accessed 2026-07-20 UTC.
- **Issue 60 — research question:** [Establish the current Codex desktop reference baseline](https://github.com/samanthar0se/Pidex/issues/60). Accessed 2026-07-20 UTC.
