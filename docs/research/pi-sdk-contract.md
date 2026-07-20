# Official Pi SDK Contract

## Scope and pinned evidence

This report resolves the question in [Establish the official Pi SDK contract](https://github.com/samanthar0se/Pidex/issues/50) for the Host destination described by [Specify the runnable Windows Host adapter bundle](https://github.com/samanthar0se/Pidex/issues/49).

- Supported package: `@earendil-works/pi-coding-agent@0.80.10`, installed at `C:/Users/User/AppData/Local/pi-node/current/node_modules/@earendil-works/pi-coding-agent`.
- The installed `README.md` and SDK source-map content match official tag `v0.80.10` at commit [`8dc78834cde4e329284cf505f9e3f99763df5529`](https://github.com/earendil-works/pi/tree/8dc78834cde4e329284cf505f9e3f99763df5529).
- The package is ESM, exposes `dist/index.d.ts`, and requires Node `>=22.19.0`; its shrinkwrap resolves `pi-agent-core`, `pi-ai`, and `pi-tui` to `0.80.10`.
- Sources used: the installed README, installed declarations/source maps/examples, and the matching official Pi tag only. Pidex adapter and Host source define the destination contract being assessed.

## Decision summary

Use the in-process Node SDK as the real adapter boundary: `ModelRuntime` + `SettingsManager` + `DefaultResourceLoader` + `createAgentSessionRuntime`/`AgentSession`. Translate Pi events and extension UI into Pidex's data-only callbacks. Keep Pidex Authority, Timeline, Interaction, and presentation state authoritative; keep Pi's session artifact private to the adapter.

Pi `0.80.10` does **not** itself provide Pidex's `probe`, capability manifest, durable-checkpoint proof, opaque checkpoint, or artifact-migration contract. The adapter must supply those surfaces and must not claim them until they are verified. The package's public RPC mode is a viable process-isolation alternative, but its typed `RpcClient` does not expose extension UI requests as a separate typed channel; a raw strict-JSONL client would be required for that route.

## Requirement assessment

### Standard resource loading and configuration — supported

Use the public `SettingsManager`, `ModelRuntime`, and `DefaultResourceLoader` surfaces. `createAgentSession()` accepts all three and defaults to the standard `cwd`/`agentDir` discovery. `SettingsManager` covers global/project settings, model defaults, queue modes, compaction, trust, extensions, skills, prompts, themes, and session directory. `ModelRuntime` owns `auth.json`, `models.json`, credential resolution, built-in/custom providers, and model catalogs.

- Set `projectTrusted: true` in the public settings construction or resolve project trust to `true` through `ResourceLoader.reload()`; do not invent a parallel credential store.
- Treat extension loading errors and resource diagnostics as readiness diagnostics, not as private loader state.
- `DefaultResourceLoader` is public and its `ResourceLoader` interface exposes resource results and `reload()`; do not reach into its private package manager or extension runner.

Evidence: [SDK options and factory](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/sdk.ts#L33-L89), [resource loader interface](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/resource-loader.ts#L38-L48), [resource loader options](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/resource-loader.ts#L122-L157), [settings schema](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/settings-manager.ts#L83-L129).

### Model and mode discovery — models supported; modes are adapter-defined

`ModelRuntime` publicly provides providers, all models, lookup by provider/id, configured-auth checks, available models, refresh, errors, and runtime API-key overrides. `resolveCliModel` and `resolveModelScopeWithDiagnostics` are also public. These implement Pidex model discovery and `model.select` constraints.

Pi has no generic capability probe and no public list of Pidex execution modes. `ExtensionMode` is only the execution context union `tui | rpc | json | print`; it is not a product mode registry. For the existing worker contract, report `mode.select` with the fixed value `agent` only after the adapter has selected the in-process agent path. `input.text`'s 100,000-byte limit is a Pidex policy and must be enforced by the adapter, not inferred from Pi.

Evidence: [ModelRuntime public methods](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/model-runtime.ts#L281-L330), [model refresh and provider registration](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/model-runtime.ts#L382-L400), [ExtensionMode](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/extensions/types.ts#L298-L335), [Pidex required capabilities](../../packages/host/src/pi-worker.ts#L11-L19).

### Session create/resume — supported

Use `SessionManager.create`, `open`, `continueRecent`, or `inMemory` for initial binding. Use `AgentSessionRuntime` for replacement operations: `newSession`, `switchSession` (resume), `fork`, and `importFromJsonl`. A resumed session restores model/thinking state from the active session when the model remains available and authenticated.

After any runtime replacement, rebind extensions and event subscriptions to `runtime.session`; captured old session-bound objects are stale. This is a required adapter invariant, not an optional convenience.

Evidence: [SessionManager factories](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1436-L1481), [runtime switch/new/fork](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session-runtime.ts#L200-L349), [runtime import](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session-runtime.ts#L351-L393), [official SDK runtime example](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/examples/sdk/13-session-runtime.ts).

### Streaming Timeline events — supported by translation

`AgentSession.subscribe()` is public. Translate:

- `message_update` plus `assistantMessageEvent.type === "text_delta"` to `assistant.delta`.
- `tool_execution_start` to `tool.started`.
- `tool_execution_end` to `tool.completed`, extracting bounded text from the result content.

The public event type also provides turn, message, agent-settled, queue, compaction, retry, model, and session-entry events. `entry_appended` is only emitted for extension `appendEntry()` actions; it is not a complete persisted-message feed. Persisted message events and live display events must therefore remain separate adapter paths.

Pi documents that parallel tool starts are emitted in assistant source order, tool updates can interleave, and tool ends complete in completion order. Pidex must serialize its own Timeline projection and must not assume tool completion order equals source order.

Evidence: [AgentSessionEvent and subscribe](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L135-L165), [subscription persistence note](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L783-L798), [event declarations](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/extensions/types.ts#L714-L772), [Pidex Timeline shape](../../packages/adapters/src/index.ts#L86-L89).

### Tool activity — supported

Built-in and extension tools have public start, partial-update, and end events. Tool definitions also expose typed parameter schemas, cancellation signals, progress updates, and optional renderers. The adapter only needs to map the start/end subset required by Pidex; it should not expose Pi renderer components across the Host seam.

Evidence: [tool event types](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/extensions/types.ts#L748-L772), [tool definition contract](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/extensions/types.ts#L407-L478).

### Structured Interactions — supported through an adapter-bound UI context

Pi's public `ExtensionUIContext` provides `select`, `confirm`, `input`, and `editor`; each can receive an `AbortSignal` or timeout. The SDK does not have an `onInteraction` option on `createAgentSession`; the adapter must bind a public UI context through `session.bindExtensions()` and translate those calls to the Pidex `onInteraction` callback. `confirm` has no public default-value argument; `input`'s placeholder is not the same as Pidex's default value, so those fields must be omitted or documented as lossy.

The RPC mode has a complete request/response UI subprotocol, but the exported `RpcClient` forwards every non-response line to an `AgentSessionEvent` listener and does not type or route `extension_ui_request` separately. A process-isolated adapter must parse raw strict LF-delimited JSONL or implement its own RPC client.

Evidence: [ExtensionUIContext](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/extensions/types.ts#L91-L218), [public binding method](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L2209-L2231), [RPC UI types](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-types.ts#L225-L275), [RPC UI implementation](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L89-L150), [typed RpcClient line handling](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-client.ts#L499-L517), [Pidex interaction shape](../../packages/adapters/src/index.ts#L56-L84).

### Presentation effects — supported subset with explicit lossiness

Map `notify`, `setStatus`, `setWidget`, `setTitle`, and `setEditorText` to the five Pidex data-only presentation effects. `undefined` clears in Pi and should become Pidex `null` for status/widget/title. Pidex's widget is a single text value while Pi can provide string arrays or a TUI component; join string lines with `\n` and reject or ignore component factories. Pi's full custom components, custom footer/header/editor, working indicator, theme objects, and direct TUI rendering are not part of the Pidex worker contract. In RPC mode those features are explicitly no-ops or unsupported.

This makes the adapter compatible with bounded effects, not with arbitrary Pi UI extensions. The extension compatibility policy must be explicit: unsupported custom UI may be ignored, or the Host may reject the extension/run; Pi supplies no manifest declaring which UI features an extension will use.

Evidence: [UI methods](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/extensions/types.ts#L127-L218), [RPC limitations](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L167-L250), [Pidex effect shape](../../packages/adapters/src/index.ts#L49-L54).

### Steering — supported

Register the receiver for the active execution as `text => session.steer(text)`. Pi steering is not an immediate token interrupt: it is delivered after the current assistant turn's tool calls and before the next LLM request. `followUp` is delivered only after the agent settles. Clear the receiver on every completion, abort, replacement, and failure, as the existing `PiSessionWorker` does.

Evidence: [AgentSession steer/follow-up](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L1315-L1354), [Pidex receiver lifetime](../../packages/host/src/pi-worker.ts#L203-L213).

### Cancellation — supported cooperatively; not a sandbox

`AgentSession.abort()` aborts the current agent operation and waits for idle. Tools receive an `AbortSignal`; extension UI dialogs can also receive a signal. This satisfies cooperative cancellation and cleanup-before-return when the adapter awaits `abort()`.

It does not provide process containment, privilege reduction, or guaranteed termination of arbitrary extension code. Pidex's Windows Job containment and forced worker-loss path remain separate native Host responsibilities. Pi extensions run with the current user's privileges.

Evidence: [abort/wait-for-idle](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L1527-L1541), [extension signal and abort context](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/extensions/types.ts#L303-L335), [Pidex containment boundary](../../packages/adapters/src/index.ts#L137-L188).

### Durable checkpoints — not provided by the Pi public contract

Pi sessions are append-only JSONL files and Pi synchronously appends entries at message completion, but `SessionManager` has no public checkpoint flush or durability-proof method. The implementation uses `writeFileSync`/`appendFileSync` and does not call `fsync`; `SettingsManager.flush()` only drains settings writes. `AgentSession.exportToJsonl()` writes a current-branch export but likewise does not establish the Pidex durability proof.

Therefore the real adapter must own `flushCheckpoint`. It may stage/export a versioned private artifact, flush the file and required parent directory using Node/Windows file APIs, hash/validate the staged result, and return an opaque adapter token. It must not return a raw session path, JSONL offset, or unversioned Pi entry ID as the Pidex checkpoint. If it cannot prove this operation, it must report `checkpoint.durable` unavailable; `PiSessionWorker` unconditionally calls `flushCheckpoint` after a successful execution.

Evidence: [session persistence](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L780-L973), [export implementation](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L3180-L3217), [session format/version](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L30-L30), [Pidex flush requirement](../../packages/host/src/pi-worker.ts#L88-L106).

### Fork — logical operation supported; Pidex checkpoint/identity needs an adapter

`AgentSessionRuntime.fork(entryId, options)` and `SessionManager.createBranchedSession()` publicly create a branch from a persisted entry. The native operation uses a Pi entry ID, creates a new Pi session file, records a `parentSession` path, and replaces the active runtime session. It does not accept Pidex's opaque checkpoint token or guarantee that the native session ID equals a caller-provided Pidex child ID.

The adapter must resolve its own checkpoint token to a valid Pi entry ID, reject non-persisted or busy fork points, call the public fork operation, rebind listeners/extensions, and map the resulting native session to the caller's Pidex child ID. Do not expose `parentSession` paths or assume Pi's generated file name is a Pidex identity.

Evidence: [runtime fork contract](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session-runtime.ts#L286-L349), [branched session implementation](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1335-L1434), [Pidex fork contract](../../packages/host/src/pi-worker.ts#L121-L147).

### Artifact migration — partial and version-matrix dependent

Pi exposes `CURRENT_SESSION_VERSION` and built-in migrations for its known session versions, and `importFromJsonl()` can import a file into the current session directory. This is not a general artifact migration API: there is no public source-version/target-version compatibility matrix, no Pidex artifact manifest, and no guarantee for an unknown future format. The JSONL format is documented, but its schema and migration behavior are version-sensitive implementation details.

The adapter must maintain an explicit supported source-to-target matrix, preserve the source artifact, migrate a copy with the exact pinned Pi converter/runtime needed for that source version, validate the resulting header/entries, and record adapter/Pi versions in its own manifest. Never claim `migrateArtifact` merely because `importFromJsonl` exists.

Evidence: [session format documentation](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/session-format.md), [import API](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session-runtime.ts#L351-L393), [session migrations](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L227-L291), [Pidex migration contract](../../packages/host/src/pi-worker.ts#L149-L166).

### Extensions — supported at the standard API, with a bounded UI boundary

`DefaultResourceLoader` loads global/project extensions and exposes `LoadExtensionsResult`; `ExtensionAPI` supports tools, event handlers, commands, resources, state, model access, and the UI context. This is sufficient for standard extension loading and tool/event compatibility.

Project extensions execute arbitrary code with the worker's user privileges. `projectTrusted: true` is therefore a deliberate trust decision, not a sandbox. The adapter should surface extension load errors and bind only the Pidex-compatible data-only UI context. Custom TUI components and other presentation features outside the Pidex effect schema are unsupported; Pi has no public preflight declaration of an extension's required UI features.

Evidence: [resource loading result](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/resource-loader.ts#L72-L105), [ExtensionAPI](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/extensions/types.ts#L493-L590), [extension security boundary](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/extensions.md), [project trust resolution](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/resource-loader.ts#L328-L370), [Pidex extension requirement](../../packages/adapters/src/index.ts#L118-L135).

### Readiness and capability probing — adapter-owned

Pi has useful diagnostics but no single probe contract. A Pidex `probe` implementation should:

1. Verify the pinned package and Node runtime.
2. Construct `SettingsManager`, `ModelRuntime`, and `DefaultResourceLoader` using the standard paths and explicit project trust policy.
3. Read model availability and `ModelRuntime.getError()`; collect `extensionsResult.errors` and resource diagnostics.
4. Verify the selected model and configured credentials without claiming that a catalog entry means a request will succeed.
5. Report static Pidex capabilities only for adapter behaviors actually implemented: `run.execute`, `runtime.cancel`, `runtime.steer`, `presentation.*`, `interaction.basic`, `model.select`, `mode.select`, `input.text`, and any proven checkpoint/migration feature.

Model refresh can be network/configuration dependent. Probe output must distinguish configured, available, and request-tested rather than turning a cached model list into a readiness guarantee. The Pidex `PiProbeResult` is the adapter's contract, not a Pi SDK type.

Evidence: [Pidex probe result](../../packages/adapters/src/index.ts#L8-L33), [model availability/error API](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/model-runtime.ts#L281-L330), [SDK result diagnostics](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/sdk.ts#L91-L136).

## Private, version-sensitive, and unsupported surfaces

- **Session JSONL:** documented and represented by exported `SessionEntry` types, but the current format is versioned (`CURRENT_SESSION_VERSION === 3`) and migration is implementation-owned. Treat file names, paths, offsets, raw IDs, and internal persistence timing as private Pi artifacts.
- **Durability:** synchronous Node writes are not an `fsync` acknowledgement. Pi has no public `flushCheckpoint`; Host-owned staging and durability validation are mandatory for `checkpoint.durable`.
- **Pi IDs:** an entry ID is a useful internal fork cursor, not a Pidex checkpoint identity. Bind it to an adapter-owned token containing version/session/artifact identity.
- **RPC UI:** the wire types exist, but the typed client is event-generic. Use direct SDK binding or a raw client; do not cast arbitrary RPC events into Pidex interactions.
- **TUI components:** custom components, renderers, themes, and editor/header/footer APIs cannot cross the Pidex data-only boundary. This is a compatibility policy, not a hidden SDK capability.
- **Containment:** the SDK does not provide Windows Job ownership or forced process termination. Keep Pidex's Host process/Job boundary around the worker.

## Decisions unblocked by this research

1. Pin `@earendil-works/pi-coding-agent@0.80.10`, Node `>=22.19.0`, and the published shrinkwrap/transitive `0.80.10` packages in the Windows bundle.
2. Implement the adapter in-process around the public SDK factory/runtime surfaces rather than copying Pi internals or treating the CLI as the contract.
3. Keep `sessionId` and all authority/timeline records Pidex-owned; maintain an adapter mapping to native Pi session files and entry IDs.
4. Map Pi subscription events to Pidex Timeline, map `steer`/`followUp` and `abort` to the corresponding public controls, and retain Windows Job containment outside Pi.
5. Bind a Pidex data-only `ExtensionUIContext`; expose only the five presentation effects and four basic interaction methods, with explicit lossy widget/default-value behavior.
6. Make probe/capabilities a wrapper-level manifest and report durable checkpoints or migration only after dedicated adapter tests prove them.

## Decisions still required before implementation

- **Checkpoint implementation:** choose a Host-owned exported/staged artifact plus Node/Windows flush-and-validate flow, or explicitly remove `checkpoint.durable` until that flow exists.
- **Fork artifact policy:** decide whether a branch checkpoint is a current-branch export or a native Pi session file, and define the adapter token/version format.
- **Migration matrix:** name the source Pi versions that Pidex must import and whether unsupported versions fail closed.
- **Unsupported extension UI:** choose reject-the-run versus no-op/diagnostic for custom TUI components and other effects outside the Pidex schema.
- **Transport:** choose direct in-process SDK binding (recommended for typed UI callbacks) versus a separate Pi RPC process with a raw strict-JSONL UI client.

## Verification performed

The exact installed package was imported with Node ESM using `VERSION === "0.80.10"`. A no-tool, in-memory session was created with `ModelRuntime`, `SettingsManager`, and `DefaultResourceLoader`; the public SDK exports resolved and the loader completed without extension errors. This smoke check validates packaging/import wiring only; it does not prove provider authentication, model request success, extension behavior, checkpoint durability, or migration compatibility.
