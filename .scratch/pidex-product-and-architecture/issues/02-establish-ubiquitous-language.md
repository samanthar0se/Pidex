Type: grilling
Status: resolved
Blocked by: 01

## Question

What canonical domain terms and relationships distinguish hosts, projects, workspaces, sessions, runs, clients, views, devices, and archived or sleeping state in Pidex?

## Comments

The canonical glossary is maintained in [`../CONTEXT.md`](../CONTEXT.md).

## Answer

Pidex uses a strict host-local ownership model. A Host is one authoritative Pidex installation. Projects are durable logical groupings that may contain concrete Workspaces. A Session is a durable conversation with optional, immutable Project and Workspace scope; a Run is one accepted execution cycle within that Session. Forking creates an independent child Session with immutable ancestry and inherited-by-default, explicitly changeable scope.

A Device is one durably paired app installation or browser profile, not physical hardware. Each live tab or window is a distinct Client whose identity can survive transport reconnection but not reload. A View is an ephemeral, client-local projection with no host-recognized identity or authoritative state.

Session retention and runtime residency are independent. Sessions are available or archived, and separately resident or sleeping. Archival is reversible and non-destructive. Pidex uses open/close for Views, wake/sleep for runtime residency, archive/restore for retention, and create/resume for starting or continuing Sessions. “Active Session” and “idle Session” are non-canonical because they obscure these axes.
