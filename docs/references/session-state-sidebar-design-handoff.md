# Session State Sidebar Design Handoff

## Purpose

Apply the settled session-state treatment to a different product that lists long-running agent or task sessions in a sidebar. This handoff is intentionally product-agnostic.

## Visual Reference

- [Interactive session-state prototype](session-status-presentation-comparison.html) (vendored alongside this handoff)
- Upstream source: `C:\git\openchamber\docs\references\session-status-presentation-comparison.html`

The prototype contains the detailed dark/light palettes, state controls, baseline comparison, responsive layout, motion, icons, rails, and labels. Treat it as the visual source of truth rather than duplicating those details here.

## Settled Direction

Use a compact **state rail + explicit label** treatment inside each sidebar row. Preserve the existing sidebar hierarchy and row density. Status should reinforce navigation rather than becoming a separate dashboard.

The design communicates state through four independent channels:

- Shape or icon
- Motion versus stillness
- Explicit text
- Semantic color

No state should depend on color or animation alone.

## State Treatments

### Working

- Animated informational-color rail on the row's leading edge.
- Spinning activity icon in the leading indicator slot.
- Compact `Working` label on the trailing edge.
- Replace ordinary timestamp metadata with a concise current-activity phrase when available.
- Motion is exclusive to active work.

### Ready For Review

- Static success-color rail.
- Outlined check icon.
- Compact `Review` label.
- Metadata states when the work finished.
- Persists until the session has been viewed or otherwise acknowledged.

### Blocked

- Static red rail.
- Outlined red exclamation icon.
- Compact red `Blocked` label.
- Metadata explains the required action, such as `Permission required`.
- Must remain visually distinct from successful completion.

### Idle

- No status rail.
- No status icon.
- No status label.
- Show ordinary recency or context metadata.

## Core Principles

- Motion means the system is actively working.
- Static emphasis means it is the user's turn to look or act.
- Successful completion and blocking are different states, not variants of a generic unread marker.
- Idle is the absence of exceptional state, not another decorated status.
- Selection and status are separate visual concepts. A selected row may still carry a state rail, icon, and label.
- Keep state treatment within the sidebar row.
- Use explicit theme palettes so rendering does not vary with browser system colors.
- Support reduced motion without losing meaning: the working icon, label, and rail still identify the state when animation is disabled.

## Scope Decisions

Included:

- Sidebar session-row presentation.
- Working, ready-for-review, blocked, and idle states.
- Explicit dark and light palettes.
- Accessible non-color distinctions.

Excluded:

- Chat or conversation-area status strips.
- Composer changes.
- Full-row status tinting.
- Reordering sessions into an activity inbox.
- New sidebar sections for running or attention states.
- Product-specific state storage or event implementation.

## Directions Considered And Rejected

- **Session status strip in the main content area:** removed because this effort is sidebar-only.
- **Full-row tint and content banner:** removed because status competed too strongly with navigation and selection.
- **Activity inbox:** removed because rows moving between sections would change the navigation model.
- **Tiny shared dot:** retained only in the baseline comparison; it does not sufficiently distinguish working, completion, and blocking.
- **Browser/system colors:** removed because `Canvas`, `AccentColor`, `LinkText`, and similar values rendered differently across browsers.
- **Neutral or warning-colored blocked state:** replaced with explicit red treatment.

## State Model Notes

The target project should derive each state from authoritative data rather than historical heuristics:

- Working should come from live execution state.
- Ready for review should come from a completed-but-unacknowledged event or record.
- Blocked should come from an unresolved permission, question, error, or other action requirement.
- Idle should mean none of the above applies.

The conversation did not settle precedence when multiple signals coexist. The target implementation must decide and test precedence explicitly. A reasonable starting point to evaluate is `blocked > working > ready for review > idle`, but this is not yet a locked design decision.

## Implementation Checklist

- Map the target project's authoritative state sources to the four presentation states.
- Decide multi-signal precedence before writing rendering logic.
- Keep the indicator slot stable so row text does not shift between states.
- Preserve existing selection, hover, nesting, pinning, and row-action behavior.
- Use semantic theme tokens in production, populated with explicit values for every supported theme.
- Add accessible labels for icons and status text.
- Verify reduced-motion behavior.
- Test long titles, narrow sidebars, nested rows, selected rows, and several simultaneous active sessions.
- Test state transitions: idle to working, working to ready, working to blocked, blocked to working, and acknowledgement to idle.

## Pidex Resolution

This handoff is implemented. The decisions it left to the target project resolved as follows.

State sources map onto existing Pidex facts, so no new durable state was introduced:

| Presentation state | Pidex derivation |
| --- | --- |
| Blocked | Session attention summary is `needs response` (an open Interaction, or a Run held after abnormal predecessor) |
| Working | Session attention summary is `working` (a `queued`, `executing`, or `cancelling` Run) |
| Ready for review | Attention is `quiet` and Session read status is `unread` |
| Idle | None of the above |

Precedence is `blocked > working > review > idle`, matching the handoff's suggested starting point and the pre-existing `FX-STATE-01` precedence.

Read status remains an independent channel rather than being folded into the four states, as `FX-DISC-04` requires. An unread `working` or `blocked` row keeps its own unread emphasis, so all four attention-by-read combinations stay distinguishable.

Two deliberate deviations:

- The attention summary is derived by the Host, not the Client. Discovery is unscoped, so a Client holds no Timeline for unselected Sessions and cannot derive an activity phrase itself. The Host projects `attention` plus an `activity` detail and timestamp, and broadcasts `session.attention-changed` to every admitted Client.
- Pidex's prior palette used green for working and amber for needs response. Adopting the handoff freed green for completion: working is now informational blue, review green, blocked red.

Requirements landed as `FX-DISC-04A` (presentation channels) and `FX-DISC-04B` (Host-derived detail line) in the [Frontend Experience Contract](../frontend-experience/README.md).

## Suggested Skills

Use equivalent skills available in the target project:

- `theme-system` for semantic colors, icons, focus, and theme parity.
- `locale-ui-patterns` for visible and accessible status copy.
- `sync-state-invariants` for authoritative live, completion, and blocked-state derivation.
- `performance-engineering` if sidebar rows subscribe to high-frequency or cross-session state.
- `prototype` for further visual iteration before production implementation.

## Next Session

Start by inspecting the target project's session row component, theme tokens, live activity source, completion acknowledgement model, and blocking signals. Then document the state precedence and adapt the prototype's row treatment to the target design system without introducing main-content changes.
