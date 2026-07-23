# Phoenix instrumentation at the Pidex/Pi boundary

## Decision

`PiSessionWorker.execute()` is not sufficient for model token and cost analytics. It is the correct place for an outer Pidex Run span, but its adapter contract intentionally exposes only reduced Timeline events and a final `{ text, checkpoint }` result. It does not expose provider, model, token usage, cache usage, reasoning tokens, response identity, or Pi's calculated costs.

Use two instrumentation layers:

1. **Host Run span:** wrap the Host's dispatch through `PiSessionWorker.execute()` to measure Pidex-owned execution, cancellation, worker loss, checkpoint settlement, and Run outcome.
2. **Worker LLM spans:** create one span for every finalized Pi assistant/provider response inside `ExactPiChild`, where the complete Pi assistant message and usage object are still available.

Add a provider-stream wrapper later only if the prototype proves that `AgentSession` completion events cannot distinguish provider retries or expose required first-token and HTTP-level details.

## Current data flow

```text
Host dispatchRun
  -> PiSessionWorker.execute(prompt)
    -> PiAdapter.execute(PiExecuteRequest)
      -> worker execute frame
        -> ExactPiChild.execute(prompt)
          -> AgentSession.prompt(prompt)
            -> ModelRuntime.streamSimple(...)
              -> provider.streamSimple(...)
```

The Host dispatches through `PiSessionWorker` at `packages/host/src/host.ts:1539`. `PiSessionWorker` validates and forwards only bounded Pidex data at `packages/host/src/pi-worker.ts:223`. The public adapter contract states that SDK objects never cross the seam and returns only text and checkpoint data at `packages/adapters/src/index.ts:30` and `packages/adapters/src/index.ts:91`.

Inside the child, `ExactPiChild.execute()` subscribes to full `AgentSession` events before calling `session.prompt()` at `packages/pi-worker/src/index.ts:231`. The current translation deliberately retains text deltas and tool start/end events while discarding all other events at `packages/pi-worker/src/index.ts:640`. The full assistant completion must therefore be observed before this translation.

The current product wiring is still incomplete: the product adapter is a `{ kind: "real" }` placeholder, while `ExactPiChild` is implemented and tested separately. Instrumentation should be introduced with the real adapter/worker connection rather than added to the deterministic Host seam alone.

## Seam comparison

| Seam | What it can prove | What it cannot prove | Use |
|---|---|---|---|
| Host dispatch / `PiSessionWorker.execute()` | Pidex Session and Run identity, prompt acceptance, local duration, cancellation, worker outcome, Timeline projection, checkpoint outcome | Actual provider calls, provider/model identity, per-call tokens, cache/reasoning details, cost | Parent Run/Agent span |
| `ExactPiChild` `AgentSession` subscription | Final assistant model/provider metadata, usage totals and breakdowns, stop reason, error, response identity, tool-loop assistant calls | Provider-internal retry attempts and some HTTP timings | Primary LLM-span seam |
| Pi agent request/response hooks | Requested model/provider, payload configuration, HTTP status/headers | Final streamed usage and cost by themselves | Optional diagnostics; never record secrets or raw payloads by default |
| `ModelRuntime`/provider stream wrapper | Exact physical provider requests, stream timing, retry/error attempts, final message | Requires a new Pi-owned wrapper or hook and deeper coupling | Add only if completion events are insufficient |
| Session aggregate statistics | Session-wide token and cost reconciliation | Per-call model/provider/error attribution | Periodic consistency check only |

## Span model

Use a trace shaped like:

```text
Pidex Run (CHAIN or AGENT)
└── Pi execution (AGENT, optional if it adds useful worker timing)
    ├── provider response (LLM)
    ├── tool execution (TOOL, optional)
    └── provider response (LLM)
```

Do not emit one span per `assistant.delta`. A tool-using Run can legitimately produce multiple LLM spans.

Each LLM span should include, when present:

- OpenInference span kind `LLM`.
- Provider and effective response model.
- Prompt, completion, and total token counts.
- Cache-read, cache-write, and reasoning-token details.
- Stop reason, response ID, and error status.
- Explicit Pidex Session, Run, and worker-generation correlation attributes.

Phoenix derives dashboard costs from model identity, token attributes, and its pricing table. Preserve Pi's own calculated cost under Pidex-specific attributes for comparison, not as a provider-invoice claim. Token mapping must be verified against fixtures for every supported provider: Pi providers do not necessarily define `input` identically when cached tokens are present.

Phoenix documents its cost attributes and calculation at <https://arize.com/docs/phoenix/tracing/how-to-tracing/cost-tracking>. OpenInference semantic conventions are maintained at <https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md>. Pi usage types are maintained at <https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts>.

No dedicated Pi OpenInference instrumentor was found. Pidex therefore needs manual spans using Phoenix/OpenInference's TypeScript packages rather than provider-specific auto-instrumentors that would cover only part of Pi's provider set and could create duplicate spans.

## Process propagation

Node async context does not cross a process boundary. The current strict worker `execute` frame has no trace context field at `packages/worker-protocol/src/index.ts:127`.

The production design should:

1. Start the Run span in the Host.
2. Inject bounded W3C `traceparent` and optional `tracestate` values into an allowlisted worker-protocol field.
3. Version the strict worker protocol for that field.
4. Extract the context in the worker before starting Pi/LLM spans.
5. Export from each process directly to Phoenix rather than forwarding spans through Pidex IPC.

For the first prototype, independent traces correlated by explicit Pidex IDs are acceptable and avoid changing the protocol before the usage mapping is proven.

## Failure and privacy requirements

- Use bounded asynchronous batch export. Never await Phoenix export in provider execution, Run settlement, or checkpoint publication.
- A full exporter queue or unavailable Phoenix service must drop telemetry rather than fail, delay, or reclassify a Pidex Run.
- Flush only during orderly Host/worker shutdown, with a bounded deadline.
- Capture metadata and numeric usage by default. Exclude prompts, responses, tool arguments, tool schemas, request payloads, API keys, authorization headers, and arbitrary OpenTelemetry baggage.
- Apply OpenInference masking before attributes reach raw OpenTelemetry spans if content capture is introduced later.
- Keep Phoenix on loopback unless it receives separate authentication, TLS, retention, and LAN threat-model review.

## Performance acceptance

Measure telemetry disabled, enabled with a healthy collector, and enabled with an unreachable collector. Preserve the existing release gates in `packages/host/src/performance-budgets.ts:1`:

- Pidex local p95 latency remains within every existing budget; provider/export waits are not charged as Pidex local work.
- Launcher/daemon and each resident worker remain below their 300 MiB RSS limits.
- Quiescent launcher/daemon CPU remains at or below 1%.
- Soak RSS growth remains at or below 10%, with no monotonically increasing handle count.
- Run results, cancellation, worker-loss classification, Timeline order, and durable checkpoint outcomes are identical when Phoenix is healthy, slow, unavailable, or restarted.
- Span cardinality is bounded by Runs, actual assistant/provider completions, and deliberately selected tool calls—not streamed deltas.

Also record serialized telemetry bytes, queue drops, exporter errors, shutdown losses, and telemetry-on/off p95 deltas. These measurements are release evidence rather than assumptions about OpenTelemetry overhead.

## Smallest safe prototype

1. Add a no-content Run span around one Host dispatch path.
2. In `ExactPiChild`, inspect `message_end` assistant events and emit one in-memory test span containing only provider, model, usage, stop reason, and Pidex correlation IDs.
3. Run deterministic fixtures for a simple response, tool loop, provider error, cancellation, cache read/write, reasoning tokens, and any provider retry behavior.
4. Assert the number of LLM spans equals observable physical provider completions and validate Phoenix's displayed token/cost values against the final Pi messages.
5. Only if retries or first-token timing remain invisible, prototype a narrow `ModelRuntime.streamSimple()` wrapper.
6. Add OTLP batch export and outage/load tests only after event and usage semantics are proven.

This prototype answers the main unresolved question without first committing Pidex to protocol changes or deep provider-runtime coupling.
