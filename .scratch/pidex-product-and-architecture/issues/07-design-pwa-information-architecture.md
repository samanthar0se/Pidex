Type: prototype
Status: resolved
Assignee: pi
Blocked by: 01, 02, 04, 13, 14

## Question

What responsive information architecture and interaction model best supports desktop-primary multi-session work and mobile supervision without coupling client views to session lifecycle?

## Comments

The decision was resolved through a live responsive prototype and comparison against the OpenAI Codex desktop app shell.

- [Throwaway prototype](../prototypes/pwa-information-architecture/README.md)
- [Codex app reference screenshot](https://static.simonwillison.net/static/2026/codex-app.jpg)
- [Pi Tin prior chat prototype](https://github.com/samanthar0se/pi-tin) — draw from its `assistant-ui` components, turn model, runtime message repository, tool cards, composer behavior, and Codex chat-fidelity plans. Its compact runtime tabs, close-stops-runtime behavior, connection model, and other lifecycle or authority choices are not Pidex precedents.

## Answer

### Reference baseline

Pidex v1 starts as a close structural and visual clone of the Codex desktop app rather than inventing a novel control-plane dashboard. Its primary surface is a quiet two-pane shell: a persistent discovery sidebar and one conversation-focused main pane. Pidex changes Codex terminology and adds only the state cues required by its Host-owned, multi-Device Session model.

V1 has no Host-wide `Attention` concept, supervision dashboard, Pidex-managed tab strip, or split view. Those are possible later evolutions, not baseline information architecture.

### Desktop shell

The sidebar contains:

- **New Session**, which opens a Client-local blank compose View;
- **Archived**, which replaces the main pane with archived Session discovery and restore actions;
- available Sessions grouped first by Project and then by Workspace where one exists, with Project-scoped Sessions grouped separately inside their Project and Host-unscoped Sessions in an Unscoped group;
- search and lightweight filtering without changing the default hierarchy; and
- fixed Host connection state, last authoritative synchronization time, Device identity, and settings at the bottom.

Within each Project/Workspace group, Sessions remain ordered by recent authoritative activity. They do not jump into state-priority sections. Compact cues and exact subtitles distinguish executing Runs, open Interactions, held queued work, available sleeping Sessions, and relevant abnormal outcomes without using the overloaded term “active.”

The main pane contains the selected Session name and Project/Workspace context, capability-dependent model and mode controls, exact-target Run actions, the Session Timeline, and the composer. Commands remain state-specific: steering targets the exact observed executing Run, follow-up creation is secondary, and Stop targets the exact Run shown. Unsupported controls are omitted or disabled from negotiated capabilities rather than simulated.

### Routable Views and lifecycle independence

One Pidex app surface shows one routable Session View. Sidebar selection changes the stable resource URL and replaces only that Client-local View; browser back and forward work normally, and browser tabs or windows provide parallel Views. Pidex v1 does not add internal Session tabs.

Opening, selecting, replacing, navigating away from, reloading, or closing a View never wakes, sleeps, archives, stops, or otherwise owns its Session. Reading a sleeping Session uses Host projections without waking Pi. Only an accepted action that requires Pi initiates demand-driven wake under the established lifecycle rules.

### New Session flow

**New Session** opens an ephemeral blank compose View with Project and optional Workspace scope, runtime options, and a Device-local draft. Backing out creates no Host object. The first submit explicitly creates the durable Session and then accepts its initial Run as distinguishable Host operations. If Session creation succeeds but Run acceptance, wake, or startup fails, the empty Session remains. A secondary explicit action may create an intentionally empty Session without a prompt.

### Interaction presentation

An open Interaction gives its Session row a compact waiting cue and creates a compact, non-interactive fact in the Session Timeline. The live response controls appear once, pinned directly above the normal composer; they do not appear as a modal, replace the composer, or duplicate interactive controls in history. Steering and follow-up composition therefore remain reachable while an Interaction is unresolved.

If several Interactions are open, the pinned area shows one of N with previous and next navigation. Timed Interactions are ordered by earliest Host deadline, followed by untimed Interactions in creation order. A terminal or withdrawn Interaction leaves the live pager and remains represented by its durable Timeline outcome. Multi-Device response races use ordinary pending intent and authoritative reconciliation; stale controls disable when another Device wins.

Pidex does not aggregate Interactions or held work into a Host-wide `Attention` destination in v1. Session-row state cues, search, recent-activity ordering, in-app notifications, and optional system notifications provide discovery without adding another top-level information hierarchy.

### Responsive mobile model

Mobile preserves the same hierarchy rather than introducing bottom navigation. The desktop sidebar becomes a slide-over drawer opened from the Session header; it contains the same New Session, Archived, Project/Workspace groups, state cues, Host status, and settings. Selecting a Session closes the drawer and replaces the one routable main View.

The conversation, Timeline, pinned Interaction area, and composer remain the primary surface. Secondary header actions collapse into an overflow menu, while exact-target Stop remains directly reachable when a Run is executing.

### Offline and reconnect presentation

Desktop keeps the Host `current`, `offline`, `reconnecting`, `update required`, or `revoked` state and last synchronization time fixed in the sidebar footer. Because that footer is hidden with the mobile drawer, a compact persistent row appears below the mobile Session header whenever the Client is not current.

Cached history remains readable with its stale basis. A Device-local Composer Draft remains editable and explicitly local and unsent, but send, steering, follow-up, Stop, Interaction responses, lifecycle actions, and all other Host mutations are disabled until the required scopes reconcile and become current. Reconnect never submits the draft automatically.
