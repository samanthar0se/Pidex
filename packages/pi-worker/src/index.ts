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
import type { PiTimelineEvent } from "../../adapters/src/index.js";

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
  #used = false;

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
    if (this.#used) throw new Error("pi-child-generation-already-executed");
    this.#used = true;

    const session = await this.#createSession();
    let text = "";
    const unsubscribe = session.subscribe(event => {
      const timelineEvent = translateTimelineEvent(event);
      if (!timelineEvent) return;

      if (timelineEvent.type === "assistant.delta") {
        text += timelineEvent.text;
      }
      onTimelineEvent?.(timelineEvent);
    });

    try {
      await session.prompt(prompt);
      const checkpoint = createHash("sha256")
        .update(JSON.stringify(session.messages))
        .digest("hex");
      return { text, checkpoint };
    } finally {
      unsubscribe();
      session.dispose();
    }
  }

  async #createSession() {
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
    return session;
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
