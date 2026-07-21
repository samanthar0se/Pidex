import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSessionEvent,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { Duplex } from "node:stream";
import type { PiTimelineEvent } from "../../adapters/src/index.js";
import {
  SessionWorkerTransport,
  type WorkerFrame,
  type WorkerGenerationIdentity,
} from "../../worker-protocol/src/index.js";
import { publishImmutableFile } from "../../durability/src/index.js";

export const EXACT_PI_VERSION = "0.80.10";

const CHECKPOINT_CHUNK_BYTES = 1024 * 1024;

export interface PiCheckpointManifest {
  schema: "pidex-pi-checkpoint-v1";
  checkpointId: string;
  sessionId: string;
  sourceCheckpointId: string | null;
  workerGeneration: number;
  releaseGeneration: string;
  piGeneration: string;
  privateLeafId: string;
  privateFormatVersion: number;
  byteLength: number;
  chunkIds: string[];
  publicationState: "published";
}

export interface PiCheckpointStoreOptions {
  chunksDirectory: string;
  manifestsDirectory: string;
}

type CheckpointPublication = Omit<PiCheckpointManifest, "schema" | "checkpointId" | "byteLength" | "chunkIds" | "publicationState"> & {
  bytes: Uint8Array;
};

/** Publishes opaque Pi state as immutable, verified content-addressed artifacts. */
export class PiCheckpointStore {
  readonly #options: PiCheckpointStoreOptions;

  constructor(options: PiCheckpointStoreOptions) {
    this.#options = { ...options };
  }

  async publish(request: CheckpointPublication): Promise<PiCheckpointManifest> {
    assertCheckpointFields(request);
    await Promise.all([
      mkdir(this.#options.chunksDirectory, { recursive: true }),
      mkdir(this.#options.manifestsDirectory, { recursive: true }),
    ]);
    const bytes = Buffer.from(request.bytes);
    const chunks = bytes.length === 0 ? [Buffer.alloc(0)] : Array.from(
      { length: Math.ceil(bytes.length / CHECKPOINT_CHUNK_BYTES) },
      (_, index) => bytes.subarray(index * CHECKPOINT_CHUNK_BYTES, (index + 1) * CHECKPOINT_CHUNK_BYTES),
    );
    const chunkIds = chunks.map(hashBytes);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]!;
      const chunkId = chunkIds[index]!;
      publishImmutableFile({
        target: join(this.#options.chunksDirectory, chunkId),
        materialize: stage => writeFileSync(stage, chunk),
        validate: candidate => {
          const actual = hashBytes(writeFileSafeRead(candidate));
          if (actual !== chunkId) throw new Error("checkpoint-chunk-integrity-failed");
        },
      });
    }
    const body = {
      schema: "pidex-pi-checkpoint-v1" as const,
      sessionId: request.sessionId,
      sourceCheckpointId: request.sourceCheckpointId,
      workerGeneration: request.workerGeneration,
      releaseGeneration: request.releaseGeneration,
      piGeneration: request.piGeneration,
      privateLeafId: request.privateLeafId,
      privateFormatVersion: request.privateFormatVersion,
      byteLength: bytes.length,
      chunkIds,
      publicationState: "published" as const,
    };
    const checkpointId = hashBytes(Buffer.from(JSON.stringify(body)));
    const manifest: PiCheckpointManifest = { ...body, checkpointId };
    const encoded = Buffer.from(JSON.stringify(manifest));
    publishImmutableFile({
      target: join(this.#options.manifestsDirectory, `${checkpointId}.json`),
      materialize: stage => writeFileSync(stage, encoded),
      validate: candidate => {
        validateCheckpointManifest(JSON.parse(writeFileSafeRead(candidate).toString()), checkpointId);
      },
    });
    return manifest;
  }

  async read(checkpointId: string): Promise<Buffer> {
    const manifest = validateCheckpointManifest(JSON.parse(await readFile(
      join(this.#options.manifestsDirectory, `${checkpointId}.json`), "utf8",
    )), checkpointId);
    const chunks = await Promise.all(manifest.chunkIds.map(async chunkId => {
      const bytes = await readFile(join(this.#options.chunksDirectory, chunkId));
      if (hashBytes(bytes) !== chunkId) throw new Error("checkpoint-chunk-integrity-failed");
      return bytes;
    }));
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== manifest.byteLength) throw new Error("checkpoint-length-mismatch");
    return bytes;
  }

  async fork(checkpointId: string, target: {
    childSessionId: string; workerGeneration: number; releaseGeneration: string;
  }): Promise<PiCheckpointManifest> {
    const source = await this.#manifest(checkpointId);
    return this.publish({
      sessionId: target.childSessionId,
      sourceCheckpointId: checkpointId,
      workerGeneration: target.workerGeneration,
      releaseGeneration: target.releaseGeneration,
      piGeneration: source.piGeneration,
      privateLeafId: source.privateLeafId,
      privateFormatVersion: source.privateFormatVersion,
      bytes: await this.read(checkpointId),
    });
  }

  async migrate(checkpointId: string, target: {
    sessionId: string; workerGeneration: number; releaseGeneration: string;
    piGeneration: string; privateFormatVersion: number;
    convert(bytes: Buffer): Promise<Uint8Array> | Uint8Array;
  }): Promise<PiCheckpointManifest> {
    const source = await this.#manifest(checkpointId);
    const converted = await target.convert(await this.read(checkpointId));
    return this.publish({
      sessionId: target.sessionId,
      sourceCheckpointId: checkpointId,
      workerGeneration: target.workerGeneration,
      releaseGeneration: target.releaseGeneration,
      piGeneration: target.piGeneration,
      privateLeafId: source.privateLeafId,
      privateFormatVersion: target.privateFormatVersion,
      bytes: converted,
    });
  }

  async #manifest(checkpointId: string): Promise<PiCheckpointManifest> {
    return validateCheckpointManifest(JSON.parse(await readFile(
      join(this.#options.manifestsDirectory, `${checkpointId}.json`), "utf8",
    )), checkpointId);
  }
}

export interface ExactPiChildBinding {
  sessionId: string;
  workerId: string;
  generation: number;
  cwd: string;
  agentDir: string;
}

export interface ExactPiRunDependencies {
  modelRuntime?: ModelRuntime;
  model?: Model<string>;
}

export interface ExactPiRunResult {
  text: string;
  checkpoint: string;
  /** Opaque private Pi state; only a configured checkpoint publisher may persist it. */
  checkpointArtifact?: Uint8Array;
  privateLeafId?: string;
  privateFormatVersion?: number;
}

interface ToolResultContent {
  type: string;
  text?: string;
}

/**
 * Executes one Run through Pi's public SDK. Each generation is permanently
 * bound to its canonical profile and cwd.
 */
export class ExactPiChild {
  readonly binding: Readonly<ExactPiChildBinding>;
  readonly #modelRuntime?: ModelRuntime;
  readonly #model?: Model<string>;
  #session?: Awaited<ReturnType<typeof createAgentSession>>["session"];
  #uiContext?: ExtensionUIContext;
  #running = false;
  #disposed = false;

  private constructor(
    binding: ExactPiChildBinding,
    dependencies: ExactPiRunDependencies,
  ) {
    this.binding = Object.freeze({ ...binding });
    this.#modelRuntime = dependencies.modelRuntime;
    this.#model = dependencies.model;
  }

  static async bind(
    binding: ExactPiChildBinding,
    dependencies: ExactPiRunDependencies = {},
  ): Promise<ExactPiChild> {
    assertValidBinding(binding);

    const [cwd, agentDir] = await Promise.all([
      realpath(binding.cwd),
      realpath(binding.agentDir),
    ]);
    return new ExactPiChild({ ...binding, cwd, agentDir }, dependencies);
  }

  async execute(
    prompt: string,
    onTimelineEvent?: (event: PiTimelineEvent) => void,
  ): Promise<ExactPiRunResult> {
    if (this.#disposed) throw new Error("pi-child-generation-disposed");
    if (this.#running) throw new Error("pi-child-generation-busy");
    this.#running = true;

    let unsubscribe: (() => void) | undefined;
    try {
      const session = await this.#getSession();
      let text = "";
      unsubscribe = session.subscribe(event => {
        const timelineEvent = translateTimelineEvent(event);
        if (!timelineEvent) return;

        if (timelineEvent.type === "assistant.delta") {
          text += timelineEvent.text;
        }
        onTimelineEvent?.(timelineEvent);
      });

      await session.prompt(prompt);
      const checkpoint = createHash("sha256")
        .update(JSON.stringify(session.messages))
        .digest("hex");
      return {
        text,
        checkpoint,
        checkpointArtifact: Buffer.from(JSON.stringify(session.messages)),
        privateLeafId: checkpoint,
        privateFormatVersion: 1,
      };
    } finally {
      unsubscribe?.();
      this.#running = false;
    }
  }

  async steer(text: string): Promise<void> {
    if (!this.#running || !this.#session) throw new Error("pi-child-steering-unavailable");
    await this.#session.steer(text);
  }

  async stop(): Promise<void> {
    if (!this.#running || !this.#session) throw new Error("pi-child-stop-unavailable");
    await this.#session.abort();
  }

  async configureUI(uiContext: ExtensionUIContext): Promise<void> {
    this.#uiContext = uiContext;
    if (this.#session) {
      await this.#session.bindExtensions({ uiContext, mode: "rpc" });
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const session = this.#session;
    if (!session) return;
    if (this.#running) await session.abort();
    session.dispose();
    this.#session = undefined;
  }

  async #getSession() {
    if (this.#session) return this.#session;
    const { cwd, agentDir } = this.binding;
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
    });
    await resourceLoader.reload();

    const modelRuntime =
      this.#modelRuntime ??
      (await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
      }));
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      model: this.#model,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(cwd),
      noTools: "all",
    });
    if (this.#uiContext) {
      await session.bindExtensions({ uiContext: this.#uiContext, mode: "rpc" });
    }
    this.#session = session;
    return this.#session;
  }
}

interface BoundPiChild {
  readonly binding: Readonly<ExactPiChildBinding>;
  execute(
    prompt: string,
    onTimelineEvent?: (event: PiTimelineEvent) => void,
  ): Promise<ExactPiRunResult>;
  steer(text: string): Promise<void>;
  stop(): Promise<void>;
  configureUI?(uiContext: ExtensionUIContext): Promise<void> | void;
  dispose(): Promise<void>;
}

export interface ExactPiWorkerEndpointOptions {
  authenticationToken: string;
  agentDir: string;
  bind?: (binding: ExactPiChildBinding) => Promise<BoundPiChild>;
  heartbeatIntervalMs?: number;
  checkpointStore?: PiCheckpointStore;
}

/** Real child-side owner for one authenticated Session duplex generation. */
export class ExactPiWorkerEndpoint {
  readonly #identity: WorkerGenerationIdentity;
  readonly #options: ExactPiWorkerEndpointOptions;
  readonly #transport: SessionWorkerTransport;
  #child?: BoundPiChild;
  #nextSequence = 0;
  #work = Promise.resolve();
  #execution?: Promise<void>;
  #activeCorrelationId?: string;
  #stopRequested = false;
  #nextInteraction = 0;
  readonly #interactions = new Map<string, {
    kind: "select" | "confirm" | "input" | "editor";
    resolve: (value: string | boolean | undefined) => void;
  }>();
  #heartbeat?: NodeJS.Timeout;
  #closed = false;
  #releaseGeneration?: string;

  constructor(
    stream: Duplex,
    identity: WorkerGenerationIdentity,
    options: ExactPiWorkerEndpointOptions,
  ) {
    this.#identity = Object.freeze({ ...identity });
    this.#options = options;
    this.#transport = new SessionWorkerTransport(stream, identity, {
      authenticationToken: options.authenticationToken,
      onFrame: frame => {
        this.#work = this.#work.then(() => this.#accept(frame)).catch(cause => {
          this.#sendFault(cause);
        });
      },
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#withdrawInteractions();
    await this.#work;
    await this.#execution;
    await this.#child?.dispose();
    this.#transport.close();
  }

  async #accept(frame: WorkerFrame): Promise<void> {
    if (frame.type === "bootstrap") {
      if (frame.piGeneration !== EXACT_PI_VERSION) {
        throw new Error("unsupported-pi-generation");
      }
      this.#releaseGeneration = frame.releaseGeneration;
      const bind = this.#options.bind ?? ExactPiChild.bind;
      this.#child = await bind({
        sessionId: frame.sessionId,
        workerId: frame.workerId,
        generation: frame.generation,
        cwd: frame.cwd,
        agentDir: this.#options.agentDir,
      });
      await this.#child.configureUI?.(this.#createUIContext());
      this.#send("ready", {
        readiness: {
          release: "ready",
          session: "ready",
          provider: "unchecked",
        },
        capabilities: [
          { id: "run.execute", version: 1 },
          { id: "input.text", version: 1, constraints: { maximumBytes: 100_000 } },
          { id: "model.select", version: 1 },
          { id: "mode.select", version: 1 },
          { id: "checkpoint.durable", version: 1 },
          { id: "interaction.basic", version: 1 },
          { id: "presentation.effects", version: 1 },
        ],
      });
      const interval = this.#options.heartbeatIntervalMs ?? 10_000;
      this.#heartbeat = setInterval(() => {
        this.#send("heartbeat", { monotonicMs: Math.floor(performance.now()) });
      }, interval);
      this.#heartbeat.unref();
      return;
    }
    if (frame.type === "steer") {
      this.#assertActiveRun(frame.correlationId);
      await this.#child!.steer(frame.text);
      return;
    }
    if (frame.type === "stop") {
      this.#assertActiveRun(frame.correlationId);
      this.#stopRequested = true;
      this.#withdrawInteractions();
      await this.#child!.stop();
      return;
    }
    if (frame.type === "interaction.response") {
      const pending = this.#interactions.get(frame.correlationId);
      if (!pending) throw new Error("stale-interaction-correlation");
      const value = frame.response.dismissed ? undefined : frame.response.value;
      if (
        (pending.kind === "confirm" && typeof value !== "boolean") ||
        (pending.kind !== "confirm" && value !== undefined && typeof value !== "string")
      ) throw new Error("invalid-interaction-response");
      this.#interactions.delete(frame.correlationId);
      pending.resolve(value);
      this.#send("interaction.applied", { correlationId: frame.correlationId });
      return;
    }
    if (frame.type !== "execute") return;
    if (!this.#child) throw new Error("generation-not-ready");
    if (this.#execution) throw new Error("generation-busy");
    this.#activeCorrelationId = frame.correlationId;
    this.#stopRequested = false;
    this.#execution = this.#execute(frame).finally(() => {
      this.#execution = undefined;
      this.#activeCorrelationId = undefined;
      this.#stopRequested = false;
    });
  }

  async #execute(frame: Extract<WorkerFrame, { type: "execute" }>): Promise<void> {
    try {
      const result = await this.#child!.execute(frame.prompt, fact => {
        this.#send("fact", { correlationId: frame.correlationId, fact });
      });
      let checkpointId = result.checkpoint;
      let checkpointState: "exported" | "published" = "exported";
      if (result.checkpointArtifact && !this.#options.checkpointStore) {
        throw new Error("checkpoint-publication-unavailable");
      }
      if (this.#options.checkpointStore && result.checkpointArtifact) {
        const manifest = await this.#options.checkpointStore.publish({
          sessionId: this.#identity.sessionId,
          sourceCheckpointId: null,
          workerGeneration: this.#identity.generation,
          releaseGeneration: this.#releaseGeneration!,
          piGeneration: EXACT_PI_VERSION,
          privateLeafId: result.privateLeafId ?? result.checkpoint,
          privateFormatVersion: result.privateFormatVersion ?? 1,
          bytes: result.checkpointArtifact,
        });
        checkpointId = manifest.checkpointId;
        checkpointState = "published";
      }
      this.#send("checkpoint", {
        correlationId: frame.correlationId,
        checkpointId,
        state: checkpointState,
      });
      this.#send("outcome", {
        correlationId: frame.correlationId,
        outcome: this.#stopRequested ? "cancelled" : "completed",
        checkpointId,
      });
    } catch (cause) {
      this.#sendFault(cause, frame.correlationId);
    }
  }

  #assertActiveRun(correlationId: string): void {
    if (!this.#child || this.#activeCorrelationId !== correlationId) {
      throw new Error("stale-run-correlation");
    }
  }

  #createUIContext(): ExtensionUIContext {
    const interaction = (
      kind: "select" | "confirm" | "input" | "editor",
      message: string,
      body: Record<string, unknown> = {},
    ) => {
      if (!this.#activeCorrelationId) return Promise.reject(new Error("ui-outside-run"));
      const correlationId = `interaction-${this.#nextInteraction++}`;
      const result = new Promise<string | boolean | undefined>(resolve => {
        this.#interactions.set(correlationId, { kind, resolve });
      });
      this.#send("interaction.request", {
        correlationId,
        runCorrelationId: this.#activeCorrelationId,
        interaction: { kind, message, ...body },
      });
      return result;
    };
    const unsupportedBlocking = () => Promise.reject(new Error("unsupported-blocking-ui"));
    return {
      select: (title: string, options: string[]) => interaction("select", title, { options }) as Promise<string | undefined>,
      confirm: (title: string, message: string) => interaction("confirm", `${title}\n${message}`) as Promise<boolean>,
      input: (title: string, placeholder?: string) => interaction("input", title, {
        ...(placeholder === undefined ? {} : { defaultValue: placeholder }),
      }) as Promise<string | undefined>,
      editor: (title: string, prefill?: string) => interaction("editor", title, {
        ...(prefill === undefined ? {} : { defaultValue: prefill }),
      }) as Promise<string | undefined>,
      notify: (text: string, level: "info" | "warning" | "error" = "info") => this.#send("presentation", {
        effect: { type: "notification", level, text },
      }),
      setStatus: (key: string, text?: string) => this.#send("presentation", {
        effect: { type: "status", key, text: text ?? null },
      }),
      setWidget: (key: string, content: string[] | ((...args: never[]) => unknown) | undefined) => {
        if (content !== undefined && !Array.isArray(content)) return;
        this.#send("presentation", {
          effect: { type: "widget", key, text: content?.join("\n") ?? null },
        });
      },
      setTitle: (text: string) => this.#send("presentation", {
        effect: { type: "title", text },
      }),
      setEditorText: (text: string) => this.#send("presentation", {
        effect: { type: "editor-text", text },
      }),
      custom: unsupportedBlocking,
      getEditorText: () => { throw new Error("unsupported-blocking-ui"); },
      onTerminalInput: () => () => {},
    } as unknown as ExtensionUIContext;
  }

  #withdrawInteractions(): void {
    for (const pending of this.#interactions.values()) {
      pending.resolve(pending.kind === "confirm" ? false : undefined);
    }
    this.#interactions.clear();
  }

  #send(type: WorkerFrame["type"], body: Record<string, unknown>): void {
    const frame = {
      ...this.#identity,
      type,
      sequence: this.#nextSequence++,
      ...body,
    } as WorkerFrame;
    this.#transport.send(frame);
  }

  #sendFault(cause: unknown, correlationId?: string): void {
    if (this.#closed) return;
    this.#send("fault", {
      scope: this.#child ? "run" : "readiness",
      ...(correlationId ? { correlationId } : {}),
      code: cause instanceof Error ? cause.message : "worker-failed",
      retryable: false,
    });
  }
}

function assertValidBinding(binding: ExactPiChildBinding): void {
  const hasValidIdentity = Boolean(binding.sessionId && binding.workerId);
  const hasValidGeneration =
    Number.isSafeInteger(binding.generation) && binding.generation >= 0;

  if (!hasValidIdentity || !hasValidGeneration) {
    throw new Error("invalid-pi-child-binding");
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeFileSafeRead(path: string): Buffer {
  return readFileSync(path);
}

function assertCheckpointFields(request: CheckpointPublication): void {
  if (
    !request.sessionId || !request.releaseGeneration || !request.piGeneration ||
    !request.privateLeafId || !Number.isSafeInteger(request.workerGeneration) ||
    request.workerGeneration < 0 || !Number.isSafeInteger(request.privateFormatVersion) ||
    request.privateFormatVersion < 0
  ) throw new Error("invalid-checkpoint-publication");
}

function validateCheckpointManifest(value: unknown, expectedId: string): PiCheckpointManifest {
  if (!value || typeof value !== "object") throw new Error("invalid-checkpoint-manifest");
  const manifest = value as PiCheckpointManifest;
  const { checkpointId, ...body } = manifest;
  if (
    manifest.schema !== "pidex-pi-checkpoint-v1" || checkpointId !== expectedId ||
    manifest.publicationState !== "published" || !Array.isArray(manifest.chunkIds) ||
    manifest.chunkIds.length === 0 || manifest.chunkIds.some(id => !/^[a-f0-9]{64}$/.test(id)) ||
    hashBytes(Buffer.from(JSON.stringify(body))) !== checkpointId
  ) throw new Error("invalid-checkpoint-manifest");
  return manifest;
}

function translateTimelineEvent(
  event: AgentSessionEvent,
): PiTimelineEvent | undefined {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type !== "text_delta") return undefined;
      return {
        type: "assistant.delta",
        text: event.assistantMessageEvent.delta,
      };
    case "tool_execution_start":
      return {
        type: "tool.started",
        toolCallId: event.toolCallId,
        name: event.toolName,
      };
    case "tool_execution_end":
      return {
        type: "tool.completed",
        toolCallId: event.toolCallId,
        name: event.toolName,
        text: renderToolResult(event.result.content),
      };
    default:
      return undefined;
  }
}

function renderToolResult(content: ToolResultContent[]): string {
  return content
    .map(item => {
      if (item.type !== "text") return "";
      return item.text ?? "";
    })
    .filter(Boolean)
    .join("\n");
}
