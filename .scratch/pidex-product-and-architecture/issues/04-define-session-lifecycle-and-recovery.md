Type: grilling
Status: resolved
Blocked by: 02, 03

## Question

What are the authoritative session, run, cancellation, sleeping, restart, resume, archive, fork, and crash-recovery semantics across daemon and Pi process lifecycles?

## Comments

Pi's documented SDK and interactive behavior were checked while resolving cancellation and queue semantics. Pi supports distinct steering and follow-up queues; interactive Escape clears both queues, restores their text to the editor, and aborts the active agent run. Abort propagates through an `AbortSignal`, and the built-in Bash tool kills its spawned process tree on abort. A custom tool or extension can still fail to cooperate, so Pidex's worker boundary remains the outer cancellation guarantee.

## Answer

### Authority and creation

The daemon is authoritative for Pidex Session identity, lifecycle state, accepted Runs, their order, and their outcomes. A new Session is durably created as available and sleeping before a Pi worker or Pi session file must exist. It may remain empty. If creation includes an initial prompt, Session creation and Run acceptance remain distinguishable: the Session survives even if wake or Pi startup fails, and the accepted Run ends failed.

A prompt becomes an authoritative Run only after the daemon validates it, assigns its Session-local identity and order, durably records it, and acknowledges acceptance. Rejection before that boundary creates no Run. Once accepted, a Run must receive exactly one visible terminal outcome and cannot disappear because a worker, daemon, client, or Host restarts.

### Run and queue semantics

One Session executes at most one Run at a time. Additional follow-up prompts may be durably accepted as ordered queued Runs, but the daemon owns that queue and does not rely on Pi's transient in-memory follow-up queue as the authoritative record.

Steering and follow-up are explicit, non-convertible actions with different meanings:

- Steering is the primary during-execution send action. It targets the exact executing Run and becomes an event within that Run.
- A follow-up is a secondary action that creates a separate queued Run to execute after its predecessor completes.
- Steering that arrives after its target is no longer executing is rejected as stale and reconciled to clients. It is never silently converted into a follow-up.

A Run remains executing through Pi's model turns, tool calls, accepted steering, automatic retries, and compaction retries. It reaches normal completion only after Pi reports full settlement and the resulting history is durable; a lower-level turn or `agent_end` event is not a Run boundary. Structured interactions may keep the Run nonterminal; their detailed states and authority rules belong to “Define the human interaction and approval model.”

Every accepted Run ends in exactly one of four terminal outcomes:

- **Completed**: Pi settled normally and the resulting history is durable.
- **Failed**: Pi settled with an unrecovered model or runtime error. Tool errors handled within the conversation do not by themselves fail the Run.
- **Cancelled**: an accepted user or Host cancellation stopped the Run.
- **Interrupted**: unexpected process loss or irreconcilable state means normal completion cannot be proven.

The next queued follow-up starts automatically only after its predecessor completes. A failed or interrupted predecessor leaves proven-undelivered follow-ups queued but held until the user explicitly releases or cancels them. Cancellation applies the Stop semantics below and cancels the queue rather than holding it.

### Cancellation

Stop targets the exact executing Run the user observed. If that Run has already ended, the daemon rejects the request as stale rather than retargeting it to a successor that started during network latency.

Once accepted, Stop moves the target through cancellation and also cancels every undelivered steering event and queued follow-up Run in that Session. The daemon first clears the runtime queues and requests Pi's normal cooperative abort. It reports cancellation complete only after the worker is idle or dead and authoritative state has been reconciled. If Pi, an extension, or a tool fails to settle within a bounded grace period, the daemon terminates only that Session worker's process tree. Because the forced stop fulfills accepted user intent, the Run outcome remains cancelled rather than interrupted. Exact grace periods and operational thresholds belong to the Windows operations and quality decisions.

Cancellation and interruption stop future execution; neither promises rollback. Partial assistant output, tool results, and already-committed filesystem, process, network, or extension side effects remain visible where recoverable. Any compensation is explicit new work.

### Wake, sleep, and client independence

Views and connections never own Session execution. Opening or reading a Session does not wake it, and closing, reloading, disconnecting, or losing every client does not stop its Runs. An accepted action that requires Pi wakes an available sleeping Session on demand.

A Session may sleep automatically or explicitly only at a verified quiescent boundary: no executing, queued, held, or cancelling Run; no unresolved interaction; and no retry, compaction, or lifecycle mutation remains. Required state is flushed before the worker is disposed. Closing the last View may inform an idle policy but is never itself a sleep command. An idle worker crash merely makes its Session sleeping; an executing worker crash invokes Run recovery.

Sleeping and waking never change retention. A Host restart does not automatically wake formerly resident Sessions except for bounded reconciliation work; ordinary history and discovery remain available from daemon-owned state.

### Archive and restore

Plain Archive is accepted only for a quiescent Session. It never silently cancels or drains work. A UI may offer an explicit Stop-then-Archive sequence, but those remain separate lifecycle actions. Successful archival makes the Session archived and sleeping; it accepts no new Runs.

Restore makes an archived Session available and sleeping. It does not wake Pi until later work requires residency. Archived Sessions remain readable, exportable, and valid parents for Forks.

Pidex v1 has no destructive Session deletion lifecycle; archival is reversible and preserves identity, history, and ancestry.

### Planned restart and unexpected recovery

A planned daemon shutdown or restart enters draining by default: it stops accepting new mutations, allows already accepted executing and queued Runs to settle, flushes state, and then stops workers. An explicit forced restart applies normal Stop semantics, so affected Runs are cancelled rather than interrupted.

After an unexpected worker, daemon, or Host loss, the daemon reconciles its durable acceptance and lifecycle records with durable Pi history and worker checkpoints before assigning outcomes. It may recover completed, failed, or cancelled when the evidence proves that terminal result. If completion cannot be proved, the executing Run becomes interrupted. Missing processes alone never prove completion, and Pidex never replays an operation merely to discover whether it committed.

Accepted follow-up Runs that are proven never dispatched remain queued, but an interruption holds them for explicit release or cancellation; recovery never auto-runs them against possibly partial context. Undelivered steering against the interrupted Run is recorded as unapplied and cannot migrate to another Run. Recovered partial history and output remain attached to the interrupted Run. The affected Session becomes sleeping until explicit work wakes a replacement worker.

### Fork

A Fork may be created from any durable history entry that the pinned Pi runtime validates as a safe branch point. A currently streaming or otherwise partial entry is not eligible. Forking from an earlier stable point does not stop or mutate an executing parent, and an archived parent need not be restored.

The Fork is a new independent, available-and-sleeping Session with immutable parent and fork-point ancestry. It inherits durable history through the fork point and inherits scope by default under the previously defined scope rules, but it inherits no worker, executing or queued Runs, steering, interactions, cancellation state, or other transient runtime work.
