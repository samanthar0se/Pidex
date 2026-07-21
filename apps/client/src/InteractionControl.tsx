import { useState, type ChangeEvent } from "react";
import type { InteractionFact, InteractionResolution } from "./client-store.js";

interface InteractionAnswer {
  value: string | boolean;
}

interface InteractionAnswerDraft {
  interactionId: string;
  answer: InteractionAnswer;
}

interface InteractionControlProps {
  interaction: InteractionFact;
  position: number;
  count: number;
  intentPhase?: string;
  executingRunId?: string;
  onWriteMessage(): void;
  onNext(): void;
  onResolve(interactionId: string, resolution: InteractionResolution): void;
  onStop?(runId: string): void;
}

export function InteractionControl({
  interaction,
  position,
  count,
  intentPhase,
  executingRunId,
  onWriteMessage,
  onNext,
  onResolve,
  onStop,
}: InteractionControlProps) {
  const [draft, setDraft] = useState<InteractionAnswerDraft>();
  const answer = answerForInteraction(draft, interaction.interactionId);
  const resolutionPending = interaction.state !== "open" || intentPhase !== undefined;
  const setAnswer = (next: InteractionAnswer | undefined) => {
    setDraft(next ? { interactionId: interaction.interactionId, answer: next } : undefined);
  };

  return <section className="interaction-control" aria-label="Open Interactions">
    <div className="interaction-heading"><strong>Interaction {position} of {count}</strong>
      <span>{interaction.runId ? `Run ${interaction.runId}` : "Session request"}{interaction.provenance ? ` · ${interaction.provenance}` : ""}</span></div>
    <p>{interaction.payload.message}</p>
    <InteractionResponseField interaction={interaction} answer={answer} onChange={setAnswer}/>
    <div className="interaction-actions">
      <button onClick={onWriteMessage}>Write message</button>
      <button disabled={count < 2} onClick={onNext}>Next request</button>
      <button disabled={resolutionPending} onClick={() => onResolve(interaction.interactionId, { kind: "dismiss" })}>Dismiss</button>
      <button disabled={resolutionPending || !answer} onClick={() => answer && onResolve(interaction.interactionId, { kind: "respond", value: answer.value })}>Respond</button>
      {executingRunId && onStop && <button aria-label={`Stop Run ${executingRunId}`} onClick={() => onStop(executingRunId)}>Stop</button>}
    </div>
    {(intentPhase ?? (interaction.state === "resolving" ? "resolving" : undefined)) && <p role="status">{intentPhase ?? interaction.state}</p>}
  </section>;
}

function InteractionResponseField({
  interaction,
  answer,
  onChange,
}: {
  interaction: InteractionFact;
  answer?: InteractionAnswer;
  onChange(answer: InteractionAnswer | undefined): void;
}) {
  const commonProps = {
    "aria-label": "Interaction response",
    value: answer === undefined ? "" : String(answer.value),
  };
  const changeText = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    onChange(event.target.value === "" ? undefined : { value: event.target.value });
  };

  switch (interaction.kind) {
    case "select":
      return <select {...commonProps} onChange={changeText}>
        <option value="">Choose…</option>
        {interaction.payload.options?.map(option => <option key={option}>{option}</option>)}
      </select>;
    case "confirm":
      return <select {...commonProps} onChange={event => {
        const value = event.target.value;
        onChange(value === "" ? undefined : { value: value === "true" });
      }}>
        <option value="">Choose…</option>
        <option value="true">Confirm</option>
        <option value="false">Decline</option>
      </select>;
    case "input":
      return <input {...commonProps} onChange={changeText}/>;
    case "editor":
      return <textarea {...commonProps} onChange={changeText}/>;
  }
}

function answerForInteraction(
  draft: InteractionAnswerDraft | undefined,
  interactionId: string,
): InteractionAnswer | undefined {
  return draft?.interactionId === interactionId ? draft.answer : undefined;
}
