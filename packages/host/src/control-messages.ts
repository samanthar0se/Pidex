import { sessionReadStateCapability } from "../../protocol/src/status.js";
import { runInputImagesSchema } from "../../protocol/src/input-image.js";
import type {
  SteerCommand,
  StopCommand,
  SubmitCommand,
} from "./store.js";

const MAX_SESSION_NAME_LENGTH = 200;
const MAX_RUN_PROMPT_LENGTH = 100_000;
const MAX_VIEW_ID_LENGTH = 200;

export interface SessionCreateMessage {
  type: "session.create";
  commandId: string;
  projectId?: string | null;
  workspaceId?: string | null;
  worktree?: SessionWorktreeSelection;
}

export type SessionWorktreeSelection =
  | { kind: "local" }
  | { kind: "new" }
  | { kind: "existing"; path: string };

export interface DirectoryBrowseMessage {
  type: "directory.browse";
  requestId: string;
  parentToken?: string | null;
}

export interface ProjectAddMessage {
  type: "project.add-from-directory";
  commandId: string;
  selectionToken: string;
  projectName: string;
}

export interface SessionForkMessage {
  type: "session.fork";
  commandId: string;
  parentSessionId: string;
  forkPointEntryId: string;
  projectId?: string | null;
  workspaceId?: string | null;
}

export interface SessionRenameMessage {
  type: "session.rename";
  commandId: string;
  sessionId: string;
  name: string;
  requiredCapability: "session.rename";
  observedMetadataRevision: number;
}

export interface SessionSleepMessage {
  type: "session.sleep";
  commandId: string;
  sessionId: string;
}

export interface SessionAvailabilityMessage {
  type: "session.archive" | "session.restore";
  commandId: string;
  sessionId: string;
  observedMetadataRevision: number;
}

export interface CapabilityBasisRequirement {
  id: string;
  version: number;
}

export interface ViewIdentity {
  viewId: string;
  draftRevision: number;
}

export interface RunSubmitMessage extends SubmitCommand {
  type: "run.submit" | "run.follow-up";
  requiredCapabilityBasis?: CapabilityBasisRequirement[];
  invokingView?: ViewIdentity;
}

export interface ViewObserveMessage extends ViewIdentity {
  type: "view.observe";
  sessionId: string;
}

export interface ScopeSetMessage {
  type: "scope.set";
  sessionIds: string[];
  cursor?: string;
  resourceRevisions?: Record<string, number>;
  protocolVersion: string;
}

export interface SessionMarkReadMessage {
  type: "session.mark-read";
  commandId: string;
  sessionId: string;
  presentedTimelineRevision: number;
  requiredCapabilityBasis: [typeof sessionReadStateCapability];
}

export interface ParsedSessionMarkReadMessage {
  commandId: string;
  command?: SessionMarkReadMessage;
}

export interface RunQueueActionMessage {
  type: "run.release" | "run.cancel";
  commandId: string;
  runId: string;
}

export interface RunSteerMessage extends SteerCommand {
  type: "run.steer";
  requiredCapability: "run.steer";
  requiredCapabilityBasis?: CapabilityBasisRequirement[];
}

export interface RunStopMessage extends StopCommand {
  type: "run.stop";
  requiredCapability: "run.stop";
}

export interface InteractionResolveMessage {
  type: "interaction.resolve";
  commandId: string;
  interactionId: string;
  workerGeneration: number;
  observedRevision: number;
  dismiss?: boolean;
  value?: unknown;
}

export function isScopeSetMessage(value: unknown): value is ScopeSetMessage {
  if (!isObject(value)) {
    return false;
  }

  const hasValidSessionIds =
    Array.isArray(value.sessionIds) &&
    value.sessionIds.every(sessionId => typeof sessionId === "string");
  const hasValidCursor =
    value.cursor === undefined || typeof value.cursor === "string";
  const hasValidResourceRevisions =
    value.resourceRevisions === undefined ||
    isNumericRecord(value.resourceRevisions);

  return (
    value.type === "scope.set" &&
    typeof value.protocolVersion === "string" &&
    hasValidSessionIds &&
    hasValidCursor &&
    hasValidResourceRevisions
  );
}

export function isSessionCreateMessage(
  value: unknown,
): value is SessionCreateMessage {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.type === "session.create" &&
    typeof value.commandId === "string" &&
    isOptionalNullableString(value.projectId) &&
    isOptionalNullableString(value.workspaceId) &&
    isSessionWorktreeSelection(value.worktree) &&
    (value.worktree === undefined ||
      value.worktree.kind === "local" ||
      (typeof value.projectId === "string" && value.workspaceId == null))
  );
}

export function isDirectoryBrowseMessage(
  value: unknown,
): value is DirectoryBrowseMessage {
  return (
    isObject(value) &&
    value.type === "directory.browse" &&
    typeof value.requestId === "string" &&
    isOptionalNullableString(value.parentToken)
  );
}

export function isProjectAddMessage(value: unknown): value is ProjectAddMessage {
  return (
    isObject(value) &&
    value.type === "project.add-from-directory" &&
    typeof value.commandId === "string" &&
    typeof value.selectionToken === "string" &&
    typeof value.projectName === "string" &&
    value.projectName.trim().length > 0 &&
    value.projectName.length <= MAX_SESSION_NAME_LENGTH
  );
}

export function isSessionForkMessage(
  value: unknown,
): value is SessionForkMessage {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.type === "session.fork" &&
    typeof value.commandId === "string" &&
    typeof value.parentSessionId === "string" &&
    typeof value.forkPointEntryId === "string" &&
    isOptionalNullableString(value.projectId) &&
    isOptionalNullableString(value.workspaceId)
  );
}

export function isSessionRenameMessage(
  value: unknown,
): value is SessionRenameMessage {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.type === "session.rename" &&
    typeof value.commandId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= MAX_SESSION_NAME_LENGTH &&
    value.requiredCapability === "session.rename" &&
    isPositiveSafeInteger(value.observedMetadataRevision)
  );
}

export function isRunSubmitMessage(value: unknown): value is RunSubmitMessage {
  if (!isObject(value)) {
    return false;
  }

  const isSubmitType =
    value.type === "run.submit" || value.type === "run.follow-up";
  const images = runInputImagesSchema.safeParse(value.images ?? []);
  return (
    isSubmitType &&
    typeof value.commandId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.prompt === "string" &&
    (value.prompt.trim().length > 0 ||
      (images.success && images.data.length > 0)) &&
    value.prompt.length <= MAX_RUN_PROMPT_LENGTH &&
    images.success &&
    value.requiredCapability === value.type &&
    (value.invokingView === undefined || isViewIdentity(value.invokingView)) &&
    (value.requiredCapabilityBasis === undefined ||
      (Array.isArray(value.requiredCapabilityBasis) &&
        value.requiredCapabilityBasis.every(isCapabilityBasisRequirement)))
  );
}

export function isViewObserveMessage(
  value: unknown,
): value is ViewObserveMessage {
  return (
    isObject(value) &&
    value.type === "view.observe" &&
    typeof value.sessionId === "string" &&
    isViewIdentity(value)
  );
}

export function isSessionSleepMessage(
  value: unknown,
): value is SessionSleepMessage {
  return (
    isObject(value) &&
    value.type === "session.sleep" &&
    typeof value.commandId === "string" &&
    value.commandId.length > 0 &&
    typeof value.sessionId === "string"
  );
}

export function isSessionAvailabilityMessage(
  value: unknown,
): value is SessionAvailabilityMessage {
  if (!isObject(value)) {
    return false;
  }

  const isAvailabilityType =
    value.type === "session.archive" || value.type === "session.restore";
  return (
    isAvailabilityType &&
    typeof value.commandId === "string" &&
    typeof value.sessionId === "string" &&
    isPositiveSafeInteger(value.observedMetadataRevision)
  );
}

export function parseSessionMarkReadMessage(
  value: unknown,
): ParsedSessionMarkReadMessage | undefined {
  if (!isObject(value) || value.type !== "session.mark-read") {
    return undefined;
  }

  return {
    commandId: typeof value.commandId === "string" ? value.commandId : "",
    command: isSessionMarkReadMessage(value) ? value : undefined,
  };
}

function isSessionMarkReadMessage(
  value: unknown,
): value is SessionMarkReadMessage {
  return (
    isObject(value) &&
    value.type === "session.mark-read" &&
    typeof value.commandId === "string" &&
    value.commandId.length > 0 &&
    typeof value.sessionId === "string" &&
    Number.isSafeInteger(value.presentedTimelineRevision) &&
    Number(value.presentedTimelineRevision) >= 0 &&
    Array.isArray(value.requiredCapabilityBasis) &&
    value.requiredCapabilityBasis.length === 1 &&
    isObject(value.requiredCapabilityBasis[0]) &&
    value.requiredCapabilityBasis[0].id === sessionReadStateCapability.id &&
    value.requiredCapabilityBasis[0].version ===
      sessionReadStateCapability.version
  );
}

export function isRunQueueActionMessage(
  value: unknown,
): value is RunQueueActionMessage {
  if (!isObject(value)) {
    return false;
  }

  const isQueueAction =
    value.type === "run.release" || value.type === "run.cancel";
  return (
    isQueueAction &&
    typeof value.commandId === "string" &&
    typeof value.runId === "string"
  );
}

export function isRunSteerMessage(value: unknown): value is RunSteerMessage {
  if (!isObject(value)) {
    return false;
  }

  const images = runInputImagesSchema.safeParse(value.images ?? []);
  return (
    value.type === "run.steer" &&
    value.requiredCapability === "run.steer" &&
    typeof value.commandId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.runId === "string" &&
    typeof value.workerGeneration === "string" &&
    isPositiveSafeInteger(value.observedTimelineRevision) &&
    typeof value.text === "string" &&
    (value.text.trim().length > 0 ||
      (images.success && images.data.length > 0)) &&
    value.text.length <= MAX_RUN_PROMPT_LENGTH &&
    images.success &&
    (value.requiredCapabilityBasis === undefined ||
      (Array.isArray(value.requiredCapabilityBasis) &&
        value.requiredCapabilityBasis.every(isCapabilityBasisRequirement)))
  );
}

export function isRunStopMessage(value: unknown): value is RunStopMessage {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.type === "run.stop" &&
    value.requiredCapability === "run.stop" &&
    typeof value.commandId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.runId === "string" &&
    typeof value.workerGeneration === "string" &&
    value.observedState === "executing" &&
    isPositiveSafeInteger(value.observedTimelineRevision)
  );
}

export function isInteractionResolveMessage(
  value: unknown,
): value is InteractionResolveMessage {
  return (
    isObject(value) &&
    value.type === "interaction.resolve" &&
    typeof value.commandId === "string" &&
    typeof value.interactionId === "string" &&
    Number.isSafeInteger(value.workerGeneration) &&
    Number.isSafeInteger(value.observedRevision) &&
    (value.dismiss === undefined || typeof value.dismiss === "boolean")
  );
}

export function supportsCapabilityBasis(
  admittedBasis: ReadonlySet<string> | undefined,
  requiredBasis: readonly CapabilityBasisRequirement[] = [],
): boolean {
  return requiredBasis.every(requirement => {
    return admittedBasis?.has(capabilityBasisKey(requirement)) === true;
  });
}

export function capabilityBasisKey(
  requirement: CapabilityBasisRequirement,
): string {
  return `${requirement.id}@${requirement.version}`;
}

function isViewIdentity(value: unknown): value is ViewIdentity {
  return (
    isObject(value) &&
    typeof value.viewId === "string" &&
    value.viewId.length > 0 &&
    value.viewId.length <= MAX_VIEW_ID_LENGTH &&
    Number.isSafeInteger(value.draftRevision) &&
    Number(value.draftRevision) >= 0
  );
}

function isCapabilityBasisRequirement(
  value: unknown,
): value is CapabilityBasisRequirement {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    Number.isSafeInteger(value.version)
  );
}

function isNumericRecord(value: unknown): value is Record<string, number> {
  return (
    isObject(value) &&
    !Array.isArray(value) &&
    Object.values(value).every(item => typeof item === "number")
  );
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isPositiveSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionWorktreeSelection(
  value: unknown,
): value is SessionWorktreeSelection | undefined {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  if (value.kind === "local" || value.kind === "new") {
    return Object.keys(value).length === 1;
  }
  return (
    value.kind === "existing" &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    value.path.length <= 32_767 &&
    Object.keys(value).length === 2
  );
}
