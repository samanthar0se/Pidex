# Pidex Chat Presentation Profile

## Status and relationship

This profile is the detailed presentation contract for `FX-TL-*`, `FX-COMP-*`, `FX-QUAL-*`, and the assistant-ui seam in `FX-ARCH-03` of the [Pidex Frontend Experience Contract](README.md). It elaborates that contract and cannot override Pidex authority, privacy, Interaction, or command rules.

The evidence basis is [ChatGPT Desktop Turn Presentation Study](../research/chatgpt-desktop-turn-presentation.md). The resulting UI is Pidex-owned; reference observations provide behavior principles, not source code or backend contracts.

## Experience goal

A Session Timeline must read like one continuous account of work. At every moment, the user should understand:

1. what they asked;
2. whether Pidex is working, waiting, responding, or finished;
3. what tools or semantic activity occurred and in what order;
4. which detail is current versus historical;
5. where the final answer begins; and
6. what action is available next.

The presentation should feel calm because identity and geometry are stable, not because useful state is hidden.

## Presentation model

### CP-MODEL-01 — Pure projection

Project authoritative `TimelineFact` values through one pure presentation function before rendering. The projection may group entries but must preserve:

- stable `entryId` identity;
- authoritative order;
- `runId` association;
- monotonic revision/finalization behavior;
- exact text;
- `toolCallId` and blob identity; and
- standalone abnormal or historical facts.

Projection output is presentation state only. It cannot become a command target or Host fact.

### CP-MODEL-02 — Turn boundary

A prompt starts a new visible turn. A differing non-null `runId` also starts a new turn when no prompt boundary is available. Entries without a turn boundary remain standalone facts or attach only to the immediately open compatible turn.

Never merge entries from different known Runs. Never reorder turns by mutable Client time.

### CP-MODEL-03 — Turn segments

A normal turn most often renders in this order:

1. prompt;
2. one grouped activity disclosure containing assistant work and tool activity;
3. unboxed response content;
4. historical Interaction or ordinary fact content; and
5. abnormal outcome/lifecycle content.

Authoritative order takes precedence over that common shape. Each consecutive activity span occupies its original position; an intervening ordinary or abnormal fact closes the current activity disclosure instead of being moved across it. Grouping does not change underlying entry sequence or identity exposed in DOM data attributes.

### CP-MODEL-04 — Phase

Derive presentation phase without inventing domain state:

- **working:** no response has started and known activity is mutable or its exact Run is executing;
- **responding:** a response entry exists and is not finalized;
- **complete:** no visible entry is mutable and no exact associated Run is executing.

These are View presentation phases, not Session or Run states. Exact abnormal facts apply their own independent tone and remain visible; they are not inferred as a turn phase.

## Turn composition

### CP-TURN-01 — Prompt

- Align prompts to the inline end.
- Bound width to 77% desktop and 86% narrow mobile.
- Use a quiet neutral fill, 16 px radius, and compact 10 × 13 px internal spacing.
- Preserve multiline text and long unbroken content without horizontal page scrolling.
- Keep edit/retry behavior out of scope unless an exact Pidex command is later specified.

### CP-TURN-02 — Activity disclosure

Render one turn-level disclosure for each consecutive span of ordinary assistant work and tool entries. A normal uninterrupted turn therefore has one disclosure; an authoritative intervening fact may split activity into more than one so presentation never reorders facts.

The trigger contains:

- `Working` while activity is primary;
- `Worked` after a response starts or activity settles;
- a finalized step count when more than one entry exists; and
- a chevron whose rotation matches panel motion.

While the disclosure is collapsed and activity is primary, present one muted line beneath the trigger for the most recent tool call. Derive a generic verb phrase from the tool name, such as `Reading a file…`, `Searching the web…`, or `Executing a command…`. Never include tool arguments, paths, commands, results, or raw output in this preview. Replace the line in place when a newer tool arrives, hide it while the disclosure is open, and remove it when the turn leaves `working`.

Do not show `for …` unless authoritative duration exists. Do not start a Client timer and present it as Host fact.

### CP-TURN-03 — Disclosure state

- Live activity starts collapsed, including newly projected tool calls.
- New activity never opens an untouched disclosure automatically.
- If the user manually toggles the disclosure, that turn enters manual mode for the remainder of its mounted lifetime.
- A running disclosure may be manually collapsed.
- A completed disclosure may be manually expanded.
- Remounting from paging or navigation may restore the phase-derived default unless a later Client preference contract persists it.
- Abnormal or required-action detail must not be auto-hidden by a normal-completion transition.

### CP-TURN-04 — Activity rows

Each projected activity entry renders one ordered row with:

- distinct assistant-work versus tool iconography;
- exact first-line summary;
- running indication only when justified by mutability/finalization;
- inert remaining raw text below the summary;
- stable `data-entry-id`, `data-kind`, and finalization attributes; and
- no fabricated success, failure, file, command, or tool label.

The panel may visually connect rows with a hairline. It must not resemble a stack of unrelated cards.

### CP-TURN-05 — Final response

- Render response text unboxed at the main narrative width.
- Use readable 1.65 line height and paragraph rhythm.
- Keep streaming text solid; never shimmer the full answer.
- Update a mutable response in place by stable `entryId` and higher revision.
- Animate the response container only on first insertion, not on every text delta.
- Mark mutable content `aria-busy` without placing the entire stream in a noisy live region.
- When finalized, expose quiet local message actions after the response.

### CP-TURN-06 — Message actions

The initial action set is **Copy response** only. It is a Client-local convenience action and does not mutate Host authority.

- Desktop reveals actions on turn hover or keyboard focus.
- Touch layouts keep the action discoverable without hover.
- Copy success changes the icon/accessible label without moving surrounding content.
- Action motion uses the basic token and is removed under reduced motion.

### CP-TURN-07 — Historical and abnormal facts

- Historical Interaction facts remain inert and appear exactly once.
- Ordinary facts use compact muted labels.
- Failed, Cancelled, Interrupted, and other exact abnormal facts stay outside the collapsed ordinary-work body.
- Severity uses a narrow accent and tinted background, not a full-width alarm unless the exact trust contract requires one.

## Tool organization

### CP-TOOL-01 — Order and identity

Tool rows follow authoritative Timeline order. `toolCallId` may provide row association but never permits Client-side reordering or deduplication beyond identical `entryId` replacement rules.

### CP-TOOL-02 — Progressive detail

The default narrative shows the semantic summary. Each tool row with raw detail is its own disclosure and starts collapsed, independently of the turn-level activity disclosure. For the current `tool-name: raw-result` projection, the tool-row trigger shows only `tool-name`; opening it reveals the complete result, including its first line. Collapsed raw output is not rendered until that tool row is opened. Future structured tool parts may add argument/result sections inside this boundary, but raw detail must remain reachable.

### CP-TOOL-03 — Grouping

Consecutive shell calls or repeated tools may be summarized only when the Host projection supplies enough structured identity to prove the grouping. Current text-only entries remain individual ordered rows inside the one turn-level disclosure.

### CP-TOOL-04 — Running and errors

- A mutable tool entry may be labeled running.
- A finalized tool entry is historical, not necessarily successful.
- Never infer an error by matching prose.
- Exact error/outcome facts auto-expose their own abnormal treatment outside ordinary collapsed work.

### CP-TOOL-05 — Interactions

Pidex Interactions are not tool approvals. Live controls remain in the control dock under `FX-INT-*`; the Timeline shows only inert durable facts.

## State choreography

### CP-FLOW-01 — Prompt acknowledgment

Insert the accepted prompt in one rendered frame. Do not wait for worker output. Preserve Composer geometry while its action changes to exact-target Stop/steer behavior.

### CP-FLOW-02 — Work begins

Insert the activity disclosure once and keep it collapsed by default. New semantic rows enter at the bottom of that disclosure without opening it, while the overall turn identity and prompt position remain stable.

### CP-FLOW-03 — Response begins

In the same committed render:

1. change `Working` to `Worked`;
2. preserve the disclosure's collapsed default or manual expansion state;
3. insert the response after the activity boundary; and
4. keep the viewport at the tail only when it was already following.

The response may use a short delayed entry so the activity-to-answer handoff reads as one transition, but total choreography must remain below 300 ms.

### CP-FLOW-04 — Response streams

Replace text in place. Do not animate height, opacity, color, or transform for each token. Allow natural text reflow while preserving the outer turn and scroll policy.

### CP-FLOW-05 — Response finalizes

Remove mutable treatment without remounting the response. Reveal finalized local actions. Do not add a redundant success banner.

### CP-FLOW-06 — Abnormal settlement

Do not use the normal `Worked` → final-answer resolution when no final answer exists and an exact abnormal outcome settles the Run. Keep inspectable work and the abnormal fact visible enough to explain the interruption.

## Motion contract

### CP-MOTION-01 — Tokens

Use only these turn-presentation tokens:

| Token | Value | Use |
|---|---:|---|
| `--motion-fast` | 120 ms | tiny icon/state replacement |
| `--motion-basic` | 160 ms | hover, focus, row insertion |
| `--motion-disclosure` | 200 ms | activity open/close and chevron |
| `--motion-relaxed` | 300 ms | drawer or large spatial continuity only |
| `--ease-standard` | `cubic-bezier(.4, 0, .2, 1)` | color/opacity |
| `--ease-enter` | `cubic-bezier(.19, 1, .22, 1)` | content entry |
| `--ease-snappy` | `cubic-bezier(.23, 1, .32, 1)` | disclosure geometry |

### CP-MOTION-02 — Limits

- Turn entry translation: at most 6 px.
- Disclosure content translation: at most 4 px.
- No turn-scale animation.
- No elastic overshoot in the reading column.
- No opacity animation longer than 200 ms for streamed content.
- No decorative infinite animation except a restrained working shimmer or progress marker.

### CP-MOTION-03 — Disclosure

Animate panel grid/height and opacity together over 200 ms with `--ease-snappy`. Rotate the chevron over the same interval. Collapsed content is `aria-hidden`, inert, and non-interactive.

### CP-MOTION-04 — New activity

Animate a newly mounted row once with 0 → 1 opacity and 4 px → 0 translation over 160 ms. Do not reanimate a row when only its revision/text changes.

### CP-MOTION-05 — Final-answer entry

Animate the newly inserted response once with 0 → 1 opacity and 6 px → 0 translation over 180 ms. During the automatic work-to-answer transition, a delay up to 60 ms is allowed.

### CP-MOTION-06 — Reduced motion

Under `prefers-reduced-motion: reduce`:

- all transforms, disclosure interpolation, and entry animations resolve immediately;
- shimmer becomes static muted text;
- chevrons jump to the correct orientation;
- scrolling uses instant behavior; and
- no state or detail becomes less visible.

## Viewport contract

### CP-SCROLL-01 — Follow threshold

Treat the View as following only while its tail is visible or no more than 24 px away. Mutable-tail updates then keep the exact tail presented.

### CP-SCROLL-02 — Detached reading

Any upward user movement that detaches the tail preserves the reading position. New entries, response growth, and disclosure transitions must not force the reader down. Show **Jump to latest**.

### CP-SCROLL-03 — Return to latest

The explicit control scrolls to the tail with a bounded smooth transition no longer than 260 ms, or instantly under reduced motion. Position the control relative to the workbench, not the global viewport.

### CP-SCROLL-04 — Disclosure continuity

Manual disclosure toggles preserve the trigger's visual position. Newly projected activity does not change disclosure state, tail distance when following, or the visible entry anchor when detached.

### CP-SCROLL-05 — Paging

Prepending older history captures the first visible authoritative entry and restores its top offset after insertion. Loading and error rows occupy stable inline space.

### CP-SCROLL-06 — Composer reserve

Timeline bottom padding and scroll padding must reserve the current dock footprint plus breathing room. Composer/Interaction takeover must not cover the final response or the jump control.

## Responsive contract

### CP-RESP-01 — Reading width

Use one content width target around 736 px on desktop. Reduce outer whitespace before reducing type size. Never require horizontal page scrolling for prose, prompts, activity, or controls.

### CP-RESP-02 — Mobile

- Preserve prompt → activity → answer order.
- Keep at least 16 px inline Timeline padding.
- Let prompt width grow to 86%.
- Keep disclosure trigger and activity summaries single-column and truncation-safe.
- Keep copy and disclosure actions touch reachable.
- Reserve safe-area-aware dock space.

### CP-RESP-03 — Dense content

Raw tool detail and code may scroll internally. The Timeline itself must not gain horizontal overflow. Long paths and unbroken tokens wrap where safe and use monospace only for detail, not the whole narrative.

## Accessibility and focus

### CP-A11Y-01 — Semantics

- Each turn is an `article` with a stable key.
- Disclosure uses a real `button` and `aria-expanded`.
- The panel is labelled by its trigger.
- Mutable activity and response use `aria-busy`.
- Collapsed content is hidden from focus and assistive navigation.

### CP-A11Y-02 — Focus

Disclosure toggle never moves focus. Newly projected activity never opens the disclosure or steals focus. If focused content would become hidden because of an authoritative replacement, move focus to the disclosure trigger before collapse.

### CP-A11Y-03 — Announcements

Announce phase changes (`Working`, `Worked`, abnormal settlement) politely once. Do not place token-streaming response text in an assertive or repeatedly replayed live region.

## assistant-ui implementation seam

### CP-AUI-01 — Ownership

Pidex owns the projection. assistant-ui may render it but may not generate IDs, reorder facts, infer finalization, submit commands, or own paging/current state.

### CP-AUI-02 — Mapping

The intended mapping is:

- Pidex turn → assistant-ui message group;
- prompt → user `MessagePrimitive` text;
- activity entries → grouped reasoning/tool parts with Pidex entry metadata;
- response → assistant text part;
- historical/abnormal facts → Pidex custom data parts;
- Composer → assistant-ui Composer primitives backed by Pidex intents; and
- viewport/jump control → assistant-ui Thread primitives backed by Pidex paging and read-through rules.

### CP-AUI-03 — Replaceability

The initial renderer may use owned React elements. Components and CSS must expose stable turn/activity/message seams so replacing their internals with assistant-ui primitives requires no Host, store, protocol, or framework refactor.

## Acceptance checklist

- [x] Two known different Runs never merge into one visible turn.
- [x] Activity order matches authoritative Timeline order.
- [x] New live activity stays collapsed until the user expands it.
- [x] A collapsed working disclosure shows only a generic one-line preview of its latest tool call.
- [x] Response arrival preserves the untouched collapsed default or manual expansion state.
- [x] Manual disclosure choice wins thereafter.
- [x] Streaming response text never shimmers wholesale.
- [x] Finalization does not remount response content.
- [x] Abnormal outcomes remain outside ordinary collapsed work.
- [x] Detached readers are not forced to the tail.
- [x] Paging preserves the first visible entry.
- [x] Reduced motion reaches every correct end state immediately.
- [x] Mobile retains readable prompt, work, answer, and dock geometry.
- [x] DOM retains authoritative entry IDs and finalization attributes.
- [x] Projection tests cover prompt/work/response grouping and known Run boundaries.
- [x] Focused visual evidence covers simultaneous completed and live turns.
