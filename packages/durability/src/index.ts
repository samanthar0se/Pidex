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

export class PublicationCollisionError extends Error {
  constructor(readonly evidencePath: string) {
    super(`Authoritative target differs; candidate retained at ${basename(evidencePath)}`);
    this.name = "PublicationCollisionError";
  }
}

export function createDurabilityPublisher(
  options: DurabilityOptions = {},
): DurabilityPublisher {
  const platform = options.platform ?? (process.platform === "win32" ? "windows" : "portable");
  const step = (value: PublicationStep): void => options.afterStep?.(value);

  const publish = (request: PublicationRequest, kind: "file" | "tree" | "replace"): void => {
    const target = resolve(request.target);
    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });
    const stage = join(parent, `.${basename(target)}.${randomUUID()}.stage`);
    let preserve = false;
    try {
      step("stage-created");
      request.materialize(stage);
      step("materialized");
      requireKind(stage, kind === "tree" ? "tree" : "file");
      validate(request.validate, stage);
      step("validated-before-publication");
      flushCandidate(stage, platform);
      step("files-flushed");

      if (kind !== "replace" && existsSync(target)) {
        requireKind(target, kind === "tree" ? "tree" : "file");
        if (!equivalent(stage, target)) {
          preserve = true;
          throw new PublicationCollisionError(stage);
        }
        rmSync(stage, { recursive: true, force: true });
      } else {
        renameSync(stage, target);
        // Directory fsync is useful on portable systems, but is not a Windows fence.
        if (platform === "portable") flushDirectory(parent);
      }
      step("published");
      validate(request.validate, target);
      step("validated-after-publication");
    } catch (error) {
      if (!preserve) rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  };

  return {
    publishImmutableFile: request => publish(request, "file"),
    publishValidatedTree: request => publish(request, "tree"),
    replaceRebuildableFile: request => publish(request, "replace"),
  };
}

const defaultPublisher = createDurabilityPublisher();
export const publishImmutableFile = (request: PublicationRequest): void =>
  defaultPublisher.publishImmutableFile(request);
export const publishValidatedTree = (request: PublicationRequest): void =>
  defaultPublisher.publishValidatedTree(request);
export const replaceRebuildableFile = (request: PublicationRequest): void =>
  defaultPublisher.replaceRebuildableFile(request);

function validate(validator: Validate, path: string): void {
  if (validator(path) === false) throw new Error("Publication candidate is invalid");
}

function requireKind(path: string, kind: "file" | "tree"): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`Materializer did not create a regular ${kind}`);
  }
}

function flushCandidate(path: string, platform: "windows" | "portable"): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Symbolic links cannot be authoritative");
  if (stat.isFile()) {
    // A write-capable handle is required for FlushFileBuffers on Windows.
    const fd = openSync(path, "r+");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    return;
  }
  if (!stat.isDirectory()) throw new Error("Only regular files and directories can be published");
  for (const name of readdirSync(path).sort()) flushCandidate(join(path, name), platform);
  if (platform === "portable") flushDirectory(path);
}

function flushDirectory(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function equivalent(left: string, right: string): boolean {
  const a = lstatSync(left);
  const b = lstatSync(right);
  if (a.isSymbolicLink() || b.isSymbolicLink()) return false;
  if (a.isFile() && b.isFile()) return readFileSync(left).equals(readFileSync(right));
  if (!a.isDirectory() || !b.isDirectory()) return false;
  const an = readdirSync(left).sort();
  const bn = readdirSync(right).sort();
  return an.length === bn.length && an.every((name, index) =>
    name === bn[index] && equivalent(join(left, name), join(right, name)));
}
