Type: grilling
Status: resolved
Blocked by:

## Question

What exact user promise, core workflows, release boundary, and measurable success criteria define Pidex's first implementation-ready product specification?

## Comments

## Answer

Pidex v1 promises one developer a complete, reconnectable Pi conversation experience from installable desktop and mobile PWAs on the local LAN, backed by one configured Windows host. The PWA can be the developer's normal interface for core Pi session work; returning to a host-local Pi UI is not required.

### Core workflows

- Create, find, open, rename, archive, resume, and fork persistent sessions.
- Read complete history and stream live run output and status.
- Compose prompts and supported inputs, select runtime-exposed model and mode options, steer an active run, and queue follow-ups where the runtime supports them.
- Answer structured Pi interactions and cancel active work.
- Move between devices or use several authenticated clients at once. Clients share live control; the host establishes authoritative ordering, rejects actions invalidated by a race, and immediately reconciles every client.
- Disconnect, sleep, close, or reload every client without stopping host-owned sessions or runs. Reconnection and tested host/application restarts recover authoritative state without losing or duplicating accepted work.

### Release boundary

- One configured Windows host and one developer across multiple authenticated devices.
- No artificial cap on persistent sessions. The specification must set and test a finite concurrent-live-session reliability baseline; behavior above that baseline may depend on host resources and later lifecycle decisions.
- Completeness means parity with core conversation and session capabilities exposed by the supported official Pi runtime boundary. Optional capabilities are negotiated rather than assumed.
- Files, Git, worktrees, terminals, background-process management, Electron packaging, multiple hosts, multiple users, and public-internet relay are outside v1. V1 preserves only the seams needed to add the already-planned later modules.
- Offline clients may display cached state but cannot claim current status or control host work until they reconnect.

### Measurable success

The primary release test is a one-week daily-driver trial in which the developer performs real Pi work through Pidex from desktop and mobile without returning to the host UI for any core session action. Across the recovery and multi-client scenarios defined by later tickets, the trial must produce no lost or duplicated accepted prompts, interaction responses, cancellations, or completed run output. The final quality ticket will turn this outcome, the concurrent-session baseline, and reconnect/restart scenarios into precise acceptance thresholds.
