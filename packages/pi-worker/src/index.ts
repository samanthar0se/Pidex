import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { PiTimelineEvent } from "../../adapters/src/index.js";

export const EXACT_PI_VERSION = "0.80.10" as const;

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

/**
 * Executes one Run through Pi's public SDK. An instance is a generation: its
 * canonical profile/cwd and loaded resources cannot be replaced after bind.
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
    if (!binding.sessionId || !binding.workerId || !Number.isSafeInteger(binding.generation) || binding.generation < 0) {
      throw new Error("invalid-pi-child-binding");
    }
    const [cwd, agentDir] = await Promise.all([
      realpath(binding.cwd),
      realpath(binding.agentDir),
    ]);
    return new ExactPiChild({ ...binding, cwd, agentDir }, dependencies);
  }

  async execute(
    prompt: string,
    onTimelineEvent?: (event: PiTimelineEvent) => void,
  ): Promise<{ text: string; checkpoint: string }> {
    if (this.#used) throw new Error("pi-child-generation-already-executed");
    this.#used = true;

    const settingsManager = SettingsManager.create(
      this.binding.cwd,
      this.binding.agentDir,
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.binding.cwd,
      agentDir: this.binding.agentDir,
      settingsManager,
    });
    await resourceLoader.reload();
    const modelRuntime =
      this.#modelRuntime ??
      (await ModelRuntime.create({
        authPath: `${this.binding.agentDir}/auth.json`,
        modelsPath: `${this.binding.agentDir}/models.json`,
      }));
    const { session } = await createAgentSession({
      cwd: this.binding.cwd,
      agentDir: this.binding.agentDir,
      modelRuntime,
      model: this.#model,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(this.binding.cwd),
      noTools: "all",
    });
    let text = "";
    const unsubscribe = session.subscribe(event => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        const delta = event.assistantMessageEvent.delta;
        text += delta;
        onTimelineEvent?.({ type: "assistant.delta", text: delta });
      } else if (event.type === "tool_execution_start") {
        onTimelineEvent?.({ type: "tool.started", toolCallId: event.toolCallId, name: event.toolName });
      } else if (event.type === "tool_execution_end") {
        const rendered = event.result.content
          .map((item: { type: string; text?: string }) =>
            item.type === "text" ? (item.text ?? "") : "",
          )
          .filter(Boolean)
          .join("\n");
        onTimelineEvent?.({ type: "tool.completed", toolCallId: event.toolCallId, name: event.toolName, text: rendered });
      }
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
}
