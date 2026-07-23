# ChatGPT Desktop Turn Presentation Study

## Research question

How does the current ChatGPT desktop Codex surface order and present a coding turn from user prompt through live agent activity, tool calls, final response, and follow-up, and which of those presentation techniques should inform Pidex without importing ChatGPT authority or proprietary implementation?

## Evidence boundary

This study records observable behavior and high-level implementation facts. It does not reproduce OpenAI source or make private backend behavior part of the Pidex contract.

- **Observed app:** Windows package `OpenAI.Codex` version `26.715.10079.0`, installed at `C:\Program Files\WindowsApps\OpenAI.Codex_26.715.10079.0_x64__2p2nqsd0c76g0`.
- **Live surface:** authenticated Codex conversation rendered by the installed app on 2026-07-23.
- **Shipped assets:** the package's distributed `app\resources\app.asar`, inspected for rendered structure, state labels, and motion constants.
- **Published sources:** OpenAI's first-party [ChatGPT desktop app](https://learn.chatgpt.com/docs/app), [long-running work](https://learn.chatgpt.com/docs/long-running-work), and [notifications](https://learn.chatgpt.com/docs/notifications) documentation.
- **Implementation target:** Pidex's existing React 19 Client and the authority boundary in [the frontend experience contract](../frontend-experience/README.md).
- **Compatibility reference:** assistant-ui's first-party [thread documentation](https://www.assistant-ui.com/docs/ui/thread) and [`@assistant-ui/react-markdown` README](https://github.com/assistant-ui/assistant-ui/tree/main/packages/react-markdown).

## Executive findings

The app does not present an agent turn as a stream of unrelated cards. It resolves the turn into a stable narrative:

1. A compact right-aligned user prompt establishes the turn.
2. Agent reasoning and tool work occupy one subordinate activity region.
3. Live activity is expanded and legible rather than replaced by a spinner.
4. When the final response begins, prior activity condenses into a `Worked for …` disclosure.
5. The final response appears unboxed at the primary reading width.
6. Message actions follow the completed response without competing with it.
7. The Composer remains a persistent follow-up surface at the bottom.

The most important behavior is not a color or radius. It is the **handoff of visual priority**: prompt → live work → final answer. Each phase keeps its identity, but only the phase that currently helps the user occupies narrative attention.

## Turn anatomy and order

### User prompt

The prompt is a compact button-like bubble with a maximum width of approximately 77% in the observed surface. Its authored text is the dominant content; timestamp and copy/edit actions are secondary. The prompt is visually bounded because it is user input, while the assistant's final response is not boxed.

The prompt remains in place throughout the turn. Live work appears after it rather than mutating the prompt into a pending state.

### Agent activity

The app distinguishes activity from the final answer. Reasoning, shell execution, file reads, search, dynamic tools, browser use, plans, and subagent work may have specialized rows, but they share one turn-level activity hierarchy.

Observed and shipped behavior includes:

- concise activity summaries instead of raw payloads in the main narrative;
- ordered details available through disclosure;
- repeated or related operations summarized with counts;
- specialized summaries such as explored files, searched the web, used an integration, or ran commands;
- active labels using restrained shimmer or progress indication;
- current detail expanded while useful;
- completed detail eligible to collapse;
- chevrons and secondary affordances quiet until hover/focus, while remaining keyboard reachable; and
- persistent exceptions for content that must remain visible, such as certain steering or interactive app content.

The shipped `tool-activity-disclosure` component keeps a running disclosure open by default, allows a manual toggle, animates measured height and opacity, and changes completed disclosures to ordinary user-controlled state. The turn renderer separately groups heterogeneous activity before presenting it.

### Activity-to-answer boundary

The distributed turn renderer contains a dedicated `worked-for` item whose localized description calls it the divider between agent activity and the final assistant response. This is a semantic boundary, not decorative metadata.

The turn becomes collapsible only after a final assistant response has started, the turn was not cancelled, and there is renderable agent activity. Live work therefore remains open while it is the only useful evidence. Once an answer exists, activity defaults to collapsed unless a user preference or an exceptional state keeps it open.

This creates a clear resolution sequence:

1. Work is primary while no answer exists.
2. The first final-response content starts the transition.
3. Work condenses to `Worked for …`.
4. The answer takes the same narrative position and becomes primary.

Cancellation is intentionally different: activity is not auto-hidden behind a successful-looking completion transition.

### Final response

The observed final response is an unboxed Markdown narrative at the primary content width. Paragraphs, lists, code references, inline code, and links carry the hierarchy. The app does not place a second assistant bubble around this content.

The final response does not shimmer as a whole. Streaming content remains readable. Entry animation is applied at a block or state boundary; token updates do not repeatedly animate layout.

Copy, rating, and branch/fork actions follow the response. Their visual weight is lower than the response itself, and they do not interrupt the prompt → work → answer scan path.

## Motion system

### Shipped tokens

The inspected package defines these broad motion constants:

| Token or use | Duration | Easing |
|---|---:|---|
| Basic interaction | 150 ms | standard ease |
| Relaxed interaction | 300 ms | standard ease |
| Enter emphasis | varies | `cubic-bezier(.19, 1, .22, 1)` |
| Snappy spatial entry | varies | `cubic-bezier(.23, 1, .32, 1)` |
| Turn activity content entry | 220 ms normally, 120 ms in reduced local mode | `cubic-bezier(.33, 1, .68, 1)` |
| Programmatic jump to bottom | 260 ms | cubic ease-out derived as `1 - (1 - t)^3` |

The motion vocabulary is small: opacity, height, short vertical translation, scale for compact overlays, and chevron rotation. Turn content uses at most an 8 px vertical offset. The effect is responsive rather than theatrical.

### Disclosure choreography

Disclosure motion coordinates several properties instead of rotating only a chevron:

- the body animates measured height and opacity;
- overflow is clipped only while closed or transitioning;
- pointer interaction is removed from collapsed content;
- `aria-expanded` tracks the trigger;
- the chevron rotates over the same motion interval;
- new content enters from slightly above while fading in; and
- scroll position is locked or compensated while the disclosure changes height.

The app's generic measured-height disclosure uses a 300 ms enter curve. Its turn-level activity content uses a shorter 220 ms handoff. assistant-ui's current reasoning and tool examples independently converge on a 200 ms disclosure and call `useScrollLock` before automatic or manual changes. A 200 ms Pidex disclosure is therefore a compatible midpoint.

### Streaming motion

Streaming is deliberately low-motion:

- current thinking or a compact running summary may shimmer;
- appended semantic activity rows may enter once;
- existing text updates in place;
- the page does not bounce on every token; and
- reduced motion removes shimmer and spatial interpolation without hiding state.

## Scroll and viewport behavior

The shipped thread viewport uses a reverse flex scroll container and explicitly disables native overflow anchoring so the application can own continuity. Important measured behaviors include:

- **24 px near-tail threshold:** within this distance, the thread is treated as following the latest content;
- **64 px near-top threshold:** nearing the top can request more history;
- **260 ms jump:** explicit return to the tail uses a bounded custom animation;
- **one-second direction memory:** recent user scroll direction prevents application updates from fighting the user;
- **footer compensation:** Composer/footer height contributes to scroll padding with an additional 16 px reserve;
- **layout preservation:** before content height changes, the current distance from the bottom is captured and restored on the next layout; and
- **virtualized geometry:** turn identity and measured height preserve position when offscreen turns change.

Pidex does not need to copy reverse scrolling or virtualization to gain the core behavior. It does need the same invariants: follow only when already near the tail, preserve the reader's anchor otherwise, compensate for Composer/disclosure height, and offer an explicit return control.

## Tool-call organization

The reference surface treats tool calls as semantic activity rather than generic JSON:

1. Preserve execution order.
2. Prefer a short verb/object summary in the collapsed narrative.
3. Group repetitions or closely related operations when the underlying facts support it.
4. Keep the active operation visible.
5. Keep raw arguments and results available on demand.
6. Auto-open states that require action or expose an error.
7. Collapse ordinary successful history after the answer takes over.
8. Never let decorative grouping change the authoritative identity or order of a call.

Pidex's current Timeline schema exposes kind, stable identity, Run identity, order, revision, finalization, text, blob identity, and tool-call identity. It does not yet expose trustworthy duration or a rich tool result status. The Pidex renderer must therefore avoid inventing elapsed time, success, failure, filenames, or tool semantics from prose. It may organize known `assistant` and `tool` entries and label only states justified by `kind`, `finalized`, and exact Host facts.

## Final-message resolution

A pleasant completion is a state transition, not an extra success card:

- the activity label changes from present progressive (`Working`) to past tense (`Worked`);
- the live disclosure closes unless the user has taken manual control;
- the final answer enters once with a restrained fade/translation;
- streaming text stays solid and readable;
- finalized actions become available after the text; and
- abnormal terminal outcomes remain explicit rather than masquerading as a normal final answer.

The Composer remains stable through this sequence. Its primary action may change from Stop/steer to Send-next, but the dock does not remount or jump.

## assistant-ui fit

assistant-ui can express this presentation without owning Pidex authority:

- `ThreadPrimitive` can supply the viewport and follow-tail behavior.
- `MessagePrimitive` can render prompt and final-answer messages.
- grouped message parts can collect reasoning and tool parts into one turn-level disclosure.
- current `ReasoningRoot` behavior auto-opens while streaming, auto-collapses when streaming ends, and lets the first manual toggle take over permanently.
- current tool-group examples use a 200 ms disclosure, stagger only newly mounted tool rows, and lock scroll during height transitions.
- `MarkdownTextPrimitive` can render final text once Pidex supplies an inert, policy-approved Markdown mapping.

Pidex must continue to own stable Timeline identity, order, revision, finalization, Run association, paging, current/stale state, Interactions, and commands. The projection into assistant-ui parts must be pure and replaceable.

## Pidex adoption decisions

Adopt:

- one cohesive turn rather than unrelated Timeline cards;
- user prompt → activity → final answer order;
- auto-open live activity and auto-collapse when the final response starts;
- manual disclosure control that persists for that mounted turn;
- 200 ms measured disclosure motion with an enter-emphasized curve;
- solid streaming answer text;
- semantic tool rows with raw inert detail;
- near-tail following and detached-reader protection;
- quiet finalized message actions; and
- complete reduced-motion behavior.

Do not adopt:

- ChatGPT terminology or product navigation;
- inferred backend states;
- proprietary component code;
- unauthoritative elapsed timers;
- automatic Interaction rendering as tool approvals;
- split review panes;
- decorative per-token motion; or
- assistant-ui ownership of Pidex command or projection state.

## Sources

- **O1:** OpenAI, [ChatGPT desktop app](https://learn.chatgpt.com/docs/app), accessed 2026-07-23.
- **O2:** OpenAI, [Long-running work](https://learn.chatgpt.com/docs/long-running-work), accessed 2026-07-23.
- **O3:** OpenAI, [Notifications](https://learn.chatgpt.com/docs/notifications), accessed 2026-07-23.
- **E1:** Installed `OpenAI.Codex` Windows package version `26.715.10079.0`, live authenticated surface, observed 2026-07-23.
- **E2:** Distributed package asset `app\resources\app.asar`, especially the shipped turn, activity disclosure, animation-token, thread-scroll, and core stylesheet bundles. File names are content-hashed and version-specific.
- **A1:** assistant-ui, [Thread documentation](https://www.assistant-ui.com/docs/ui/thread), accessed 2026-07-23.
- **A2:** assistant-ui, [`@assistant-ui/react-markdown`](https://github.com/assistant-ui/assistant-ui/tree/main/packages/react-markdown), accessed 2026-07-23.
- **P1:** Pidex, [Frontend Experience Contract](../frontend-experience/README.md).
