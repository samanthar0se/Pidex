Type: grilling
Status: resolved
Assignee: pi
Blocked by: 03, 04, 05, 06

## Question

What canonical terms, states, authority rules, timeout and cancellation semantics, and multi-client response behavior should Pidex use for structured Pi extension interactions, permission requests, and approvals?

## Comments

Pi's current SDK and extension documentation were checked while resolving this decision. Pi provides generic `select`, `confirm`, `input`, and `editor` dialogs, with explicit RPC cancellation and optional timeout support on select, confirm, and input. It has no built-in permission or approval domain; extensions may build such workflows on top of generic dialogs.

## Answer

### Canonical model and scope

Pidex models every response-bearing Pi extension request as an **Interaction**. Its kind is exactly `select`, `confirm`, `input`, or `editor`; Pidex does not inspect titles, messages, options, or extension identity to infer an Approval, Permission Request, danger level, or durable permission grant. An **Interaction Response** is the first Host-accepted submitted value or explicit dismissal. The canonical glossary in [`../CONTEXT.md`](../CONTEXT.md) records those terms and replaces earlier approval-specific language.

Every Interaction has an immutable Host identity, Session identity, optional originating Run identity, Pi worker generation and request correlation, extension provenance where available, kind-specific payload, creation time, optional absolute deadline, state, and monotonic revision. Request payloads are bounded, schema-validated, and rendered as inert text rather than executable markup. Select responses must equal an offered value, confirm responses are booleans, and input or editor responses are strings within negotiated limits.

A Session may have several independent open Interactions. Immediate extension commands can therefore request UI while a Run or another command is already waiting. An Interaction is not a Session-wide modal lock, and a Client View never owns it.

Pi notifications, keyed status and widget updates, title updates, and editor-text injection are presentation effects rather than Interactions: they expect no response, create no waiting state, and do not block Run settlement. Status, widget, and title projections remain Session-scoped worker-generation state and disappear when replaced, cleared, or invalidated by worker loss; a title update never renames the Session. Notification delivery, background surfacing, and offline behavior remain governed by “Define offline cache and background behavior.”

### Authoritative state machine

An Interaction begins **open**. A valid Host-accepted response moves it to transient **resolving**, which reserves it against competing Devices while the Host delivers the answer only to the exact live Pi request. It then reaches exactly one terminal state:

- **responded**: the worker acknowledged consuming a submitted kind-valid value, including `false` for confirm.
- **dismissed**: the worker acknowledged an explicit user dismissal, mapped to Pi's cancelled/default return.
- **expired**: the extension-declared deadline won the Host race before a response was accepted, so Pi receives its timeout default.
- **withdrawn**: Pi or the Host ceased awaiting the response because of programmatic abort, applicable Run termination or Stop, worker loss, or another source invalidation.

The Host serializes deadline, response, dismissal, withdrawal, and Stop transitions. Whichever valid transition commits first determines the result; accepting a response cancels its deadline. If a response was durably accepted but the exact worker does not acknowledge it before withdrawal or loss, the Interaction becomes withdrawn and records that the response was accepted but application is unproven. Pidex never replays that value into a replacement worker or another request.

An executing Run remains **executing** while it has open or resolving Interactions. `awaiting interaction` is a derived status for presentation and supervision, not a fifth Run state. Only the Pi continuation awaiting a particular response is blocked; follow-ups may still queue, valid steering may still target the Run, and immediate extension commands may still execute under their existing rules.

### Multi-Device authority and reconciliation

Any Paired Device may respond to any visible open Interaction. The command targets the exact Interaction identity, worker generation, and observed revision. In the Host's durable acceptance transaction, the first valid response reserves the Interaction and receives the normal command receipt; later races are rejected as stale and reconciled against current state. There is no claim, voting, initiating-Device preference, Client ownership, or automatic retargeting.

Every subscribed Client observes the same authoritative request, state, deadline, terminal outcome, response time, and responding Device label. The submitting Client may show pending intent, but it changes authoritative state only through the normal Host change stream. Disconnecting, closing, reloading, or losing every Client neither dismisses nor transfers an Interaction. Session snapshots include every unresolved Interaction, and Host-level summaries expose enough waiting status for multi-Session supervision without requiring an open View.

### Timeouts and cancellation

Only a timeout declared by the extension creates a deadline. The Host converts it to one absolute authoritative deadline when accepting the worker request; Client reconnects, View changes, and Device changes never restart or extend it. Clients render countdowns from Host time synchronization, but their local timers have no authority. Pidex adds no default, disconnect, inactivity, or Host-wide maximum timeout. An untimed Interaction may remain open indefinitely and keeps its Session non-quiescent until response, dismissal, withdrawal, or Stop.

Dismiss and Stop remain different actions. Dismiss targets one exact open Interaction, returns Pi's cancellation/default value, and allows the extension to decide whether execution continues. Stop targets the exact executing Run and withdraws that Run's open or resolving Interactions before applying the established cooperative-then-forced Run cancellation semantics; it does not silently withdraw unrelated Session-level command Interactions. Worker loss withdraws every unresolved Interaction owned by that worker generation.

### Retention and free-form values

Interaction creation, state changes, terminal cause, timestamps, provenance, and responding Device are durable Host facts represented in the Session Timeline. Confirm and select responses remain durable because they are bounded values already displayed by the request. Input and editor response plaintext is available only as needed to deliver it to the exact live worker; after acknowledgement it is excluded from the Timeline, command result, diagnostics, logs, and Device caches. Durable receipts retain a digest and outcome sufficient for command deduplication. An extension may independently write the value into Pi history, a tool result, a file, or an external system; Pidex cannot redact that separate side effect.

### Client-local composer effects

A Composer Draft remains non-authoritative Device-local state. Editor-text injection caused by a Client-invoked extension command targets only that Client's matching Session View and observed draft revision. If the Client or View is gone, or the draft revision changed, Pidex does not overwrite, broadcast, or reroute the draft; it exposes the text as a non-destructive suggestion that a Client may explicitly apply. The Host routes this effect but never creates a shared authoritative draft.
