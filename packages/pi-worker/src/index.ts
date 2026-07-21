import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { Duplex } from "node:stream";
import type { PiTimelineEvent } from "../../adapters/src/index.js";
import {
  SessionWorkerTransport,
  type WorkerFrame,
  type WorkerGenerationIdentity,
} from "../../worker-protocol/src/index.js";

export const EXACT_PI_VERSION = "0.80.10";

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
      return { text, checkpoint };
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
  dispose(): Promise<void>;
}

export interface ExactPiWorkerEndpointOptions {
  authenticationToken: string;
  agentDir: string;
  bind?: (binding: ExactPiChildBinding) => Promise<BoundPiChild>;
  heartbeatIntervalMs?: number;
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
  #heartbeat?: NodeJS.Timeout;
  #closed = false;

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
      const bind = this.#options.bind ?? ExactPiChild.bind;
      this.#child = await bind({
        sessionId: frame.sessionId,
        workerId: frame.workerId,
        generation: frame.generation,
        cwd: frame.cwd,
        agentDir: this.#options.agentDir,
      });
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
      await this.#child!.stop();
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
      this.#send("checkpoint", {
        correlationId: frame.correlationId,
        checkpointId: result.checkpoint,
        state: "exported",
      });
      this.#send("outcome", {
        correlationId: frame.correlationId,
        outcome: this.#stopRequested ? "cancelled" : "completed",
        checkpointId: result.checkpoint,
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
