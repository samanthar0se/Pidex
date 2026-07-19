import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type PublicationStep =
  | "stage-created"
  | "materialized"
  | "validated-before-publication"
  | "files-flushed"
  | "published"
  | "validated-after-publication";

export type Materialize = (stagedTarget: string) => void;
export type Validate = (candidate: string) => boolean | void;

export interface PublicationRequest {
  target: string;
  materialize: Materialize;
  validate: Validate;
}

/** The complete caller-facing filesystem authority seam. */
export interface DurabilityPublisher {
  publishImmutableFile(request: PublicationRequest): void;
  publishValidatedTree(request: PublicationRequest): void;
  replaceRebuildableFile(request: PublicationRequest): void;
}

export interface DurabilityOptions {
  platform?: "windows" | "portable";
  /** Deterministic fault seam. Real IO and flushes still occur before this hook. */
  afterStep?: (step: PublicationStep) => void;
}

type DurabilityPlatform = NonNullable<DurabilityOptions["platform"]>;
type PublicationKind = "file" | "tree" | "replace";
type CandidateKind = "file" | "tree";

export class PublicationCollisionError extends Error {
  constructor(readonly evidencePath: string) {
    super(`Authoritative target differs; candidate retained at ${basename(evidencePath)}`);
    this.name = "PublicationCollisionError";
  }
}

export function createDurabilityPublisher(
  options: DurabilityOptions = {},
): DurabilityPublisher {
  const platform = options.platform ?? defaultPlatform();
  const reportStep = (step: PublicationStep): void => options.afterStep?.(step);

  return {
    publishImmutableFile: request =>
      publish(request, "file", platform, reportStep),
    publishValidatedTree: request =>
      publish(request, "tree", platform, reportStep),
    replaceRebuildableFile: request =>
      publish(request, "replace", platform, reportStep),
  };
}

const defaultPublisher = createDurabilityPublisher();
export const publishImmutableFile = (request: PublicationRequest): void =>
  defaultPublisher.publishImmutableFile(request);
export const publishValidatedTree = (request: PublicationRequest): void =>
  defaultPublisher.publishValidatedTree(request);
export const replaceRebuildableFile = (request: PublicationRequest): void =>
  defaultPublisher.replaceRebuildableFile(request);

function defaultPlatform(): DurabilityPlatform {
  return process.platform === "win32" ? "windows" : "portable";
}

function publish(
  request: PublicationRequest,
  publicationKind: PublicationKind,
  platform: DurabilityPlatform,
  reportStep: (step: PublicationStep) => void,
): void {
  const target = resolve(request.target);
  const parent = dirname(target);
  const candidateKind = getCandidateKind(publicationKind);
  mkdirSync(parent, { recursive: true });

  const stage = join(parent, `.${basename(target)}.${randomUUID()}.stage`);
  let preserveStage = false;

  try {
    reportStep("stage-created");
    request.materialize(stage);
    reportStep("materialized");

    requireKind(stage, candidateKind);
    validate(request.validate, stage);
    reportStep("validated-before-publication");

    flushCandidate(stage, platform);
    reportStep("files-flushed");

    if (publicationKind !== "replace" && existsSync(target)) {
      requireKind(target, candidateKind);
      if (!equivalent(stage, target)) {
        preserveStage = true;
        throw new PublicationCollisionError(stage);
      }
      rmSync(stage, { recursive: true, force: true });
    } else {
      renameSync(stage, target);
      // Directory fsync is useful on portable systems, but is not a Windows fence.
      if (platform === "portable") {
        flushDirectory(parent);
      }
    }

    reportStep("published");
    validate(request.validate, target);
    reportStep("validated-after-publication");
  } catch (error) {
    if (!preserveStage) {
      rmSync(stage, { recursive: true, force: true });
    }
    throw error;
  }
}

function getCandidateKind(publicationKind: PublicationKind): CandidateKind {
  switch (publicationKind) {
    case "tree":
      return "tree";
    case "file":
    case "replace":
      return "file";
  }
}

function validate(validator: Validate, path: string): void {
  if (validator(path) === false) {
    throw new Error("Publication candidate is invalid");
  }
}

function requireKind(path: string, kind: CandidateKind): void {
  const stat = lstatSync(path);
  const isExpectedKind = kind === "file" ? stat.isFile() : stat.isDirectory();
  if (stat.isSymbolicLink() || !isExpectedKind) {
    throw new Error(`Materializer did not create a regular ${kind}`);
  }
}

function flushCandidate(path: string, platform: DurabilityPlatform): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be authoritative");
  }
  if (stat.isFile()) {
    // A write-capable handle is required for FlushFileBuffers on Windows.
    const fd = openSync(path, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return;
  }
  if (!stat.isDirectory()) {
    throw new Error("Only regular files and directories can be published");
  }
  for (const name of readdirSync(path).sort()) {
    flushCandidate(join(path, name), platform);
  }
  if (platform === "portable") {
    flushDirectory(path);
  }
}

function flushDirectory(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function equivalent(left: string, right: string): boolean {
  const leftStat = lstatSync(left);
  const rightStat = lstatSync(right);
  if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) {
    return false;
  }
  if (leftStat.isFile() && rightStat.isFile()) {
    return readFileSync(left).equals(readFileSync(right));
  }
  if (!leftStat.isDirectory() || !rightStat.isDirectory()) {
    return false;
  }

  const leftEntries = readdirSync(left).sort();
  const rightEntries = readdirSync(right).sort();
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      (name, index) =>
        name === rightEntries[index] &&
        equivalent(join(left, name), join(right, name)),
    )
  );
}
