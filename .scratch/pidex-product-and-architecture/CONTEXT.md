# Pidex Domain Language

Canonical language for Pidex's host-owned coding sessions, their execution, and access from paired applications. These terms keep durable domain identity separate from runtime residency, retention, connectivity, and presentation.

## Core Work

**Host**:
One authoritative Pidex installation that owns its domain objects. Its identity survives restarts and upgrades, but not a reinstall that does not restore that identity.
_Avoid_: Server, daemon, machine

**Project**:
A durable, user-recognized body of code and related work that groups sessions and may contain workspaces. A project does not require workspace tooling or a concrete working copy.
_Avoid_: Workspace, repository, folder

**Workspace**:
A concrete working copy or execution environment within one project, such as a repository checkout or worktree.
_Avoid_: Project, repository

**Session**:
A durable conversation whose history continues across runs, clients, disconnects, and host restarts. It has fixed project and workspace scope, either of which may be absent.
_Avoid_: Chat, thread, active session, idle session

**Run**:
One accepted execution cycle within a session, initiated by an accepted prompt or follow-up and ending in one terminal outcome. Steering, approval responses, and cancellation requests are events within the affected run.
_Avoid_: Session, turn, task

**Queued**:
The nonterminal state of an accepted run that has not been dispatched to Pi. A queued run may be eligible to execute next or held for explicit user release after an abnormal predecessor outcome.
_Avoid_: Pending prompt, Pi queue

**Executing**:
The nonterminal state of the one run in a session that has been dispatched to Pi and has not yet reached a terminal outcome.
_Avoid_: Active session, running session

**Completed**:
The terminal outcome of a run for which Pi reached normal settlement and the resulting history became durable.
_Avoid_: Succeeded

**Failed**:
The terminal outcome of a run that could not begin or settle because of an unrecovered model or runtime error.
_Avoid_: Interrupted, cancelled

**Cancelled**:
The terminal outcome of a run stopped by an accepted user or host cancellation request.
_Avoid_: Failed, interrupted, rolled back

**Interrupted**:
The terminal outcome of a run whose normal completion cannot be proven after unexpected process loss or irreconcilable runtime state.
_Avoid_: Failed, cancelled, resumed

**Fork**:
A new, independent session created from a chosen point in a parent session's accepted history, with immutable parent and fork-point ancestry. It inherits scope by default but may choose another valid project and workspace scope when created.
_Avoid_: Copy, duplicate, linked branch

## Access And Presentation

**Device**:
One durably paired Pidex app installation or browser profile. Separate credential stores are separate devices even on the same physical machine.
_Avoid_: Physical device, machine, client

**Client**:
One live Pidex app context, such as a tab or standalone window, belonging to a device. Its identity survives a temporary connection loss but not a reload or close and reopen.
_Avoid_: Device, connection, view

**View**:
One ephemeral, client-local presentation of a resource such as a session, project, or dashboard. It has no host-recognized identity or authoritative state.
_Avoid_: Client, session

## Session Classification

Retention and runtime residency are independent axes. Never use _active session_ or _idle session_; name the exact run, retention, residency, or view state instead.

**Available**:
The retention state of a session in normal discovery and use, independent of residency and run execution.
_Avoid_: Active, open, awake

**Archived**:
The reversible retention state of a session removed from normal discovery and use without deleting its identity, history, or ancestry. An archived session accepts no new runs and is sleeping once archival completes.
_Avoid_: Deleted, closed, sleeping

**Resident**:
The runtime-residency state of a session whose Pi execution context is loaded, whether or not a run is executing or a client is viewing it.
_Avoid_: Active, open, running

**Sleeping**:
The runtime-residency state of a retained session whose Pi execution context is not loaded. An available session may be sleeping.
_Avoid_: Archived, idle, closed

## Lifecycle Actions

**Open / Close**:
Create or remove a client-local view without changing the session's retention or residency.

**Wake / Sleep**:
Load or unload a session's Pi execution context without changing its retention state.

**Archive / Restore**:
Move a session between archived and available retention without deleting it.

**Create / Resume**:
Start a new session or continue an existing session with new work; resuming wakes a sleeping session when necessary.

## Relationships

- A host owns its projects, workspaces, sessions, runs, and device records.
- A workspace belongs to exactly one project.
- A session belongs to zero or one project and targets zero or one workspace.
- A workspace-targeted session belongs to that workspace's project.
- A run belongs to exactly one session.
- A device is paired with exactly one host per host-local identity.
- A client belongs to exactly one device and connects to exactly one host at a time.
- A view belongs to exactly one client.
- Host-local identities are never shared across hosts; a future transfer or import creates host-local objects.
