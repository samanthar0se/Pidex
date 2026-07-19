import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export type PublicationStep =
  | "stage-created"
  | "materialized"
  | "validated-before-publication"
  | "regular-files-flushed"
  | "writers-closed"
  | "published"
  | "validated-after-publication"
  | "parent-directory-flushed"
  | "parent-directory-flush-unsupported"
  | "stage-cleaned";

export interface PublicationRequest {
  target: string;
  materialize(stage: string): void;
  /** Throw, or return false, to reject a candidate. This must not mutate it. */
  validate(candidate: string): void | boolean;
}

export interface PublicationResult {
  target: string;
  outcome: "published" | "already-published";
}

export class PublicationCollisionError extends Error {
  readonly evidencePath: string;

  constructor(target: string, evidencePath: string) {
    super(`Non-equivalent publication already exists at ${target}; candidate retained at ${evidencePath}`);
    this.name = "PublicationCollisionError";
    this.evidencePath = evidencePath;
  }
}

interface DurabilityPlatformAdapter {
  step(step: PublicationStep, path: string): void;
  flushFile(path: string): void;
  flushDirectory(path: string): "flushed" | "unsupported";
}

export interface DeterministicPublicationOptions {
  onStep?(step: PublicationStep, path: string): void;
  failAt?: PublicationStep;
  platform?: "windows" | "portable";
}

/** Real filesystem adapter with stable observation and fault-injection points. */
export function createDeterministicPublicationAdapter(
  options: DeterministicPublicationOptions = {},
): DurabilityPlatformAdapter {
  return createAdapter(options.platform ?? (process.platform === "win32" ? "windows" : "portable"), options);
}

const productionAdapter = createAdapter(process.platform === "win32" ? "windows" : "portable");

export function publishImmutableFile(
  request: PublicationRequest,
  adapter: DurabilityPlatformAdapter = productionAdapter,
): PublicationResult {
  return publish(request, "file", false, adapter);
}

export function publishValidatedTree(
  request: PublicationRequest,
  adapter: DurabilityPlatformAdapter = productionAdapter,
): PublicationResult {
  return publish(request, "tree", false, adapter);
}

export function replaceRebuildableFile(
  request: PublicationRequest,
  adapter: DurabilityPlatformAdapter = productionAdapter,
): PublicationResult {
  return publish(request, "file", true, adapter);
}

function publish(
  request: PublicationRequest,
  kind: "file" | "tree",
  replace: boolean,
  adapter: DurabilityPlatformAdapter,
): PublicationResult {
  const parent = dirname(request.target);
  mkdirSync(parent, { recursive: true });
  const stage = join(parent, `.${basename(request.target)}.${randomUUID()}.stage`);
  let preserveEvidence = false;
  try {
    if (kind === "tree") mkdirSync(stage);
    adapter.step("stage-created", stage);
    request.materialize(stage);
    adapter.step("materialized", stage);
    assertCandidate(stage, kind);
    validate(request, stage);
    adapter.step("validated-before-publication", stage);
    flushRegularFiles(stage, kind, adapter);
    adapter.step("regular-files-flushed", stage);
    assertNoOpenWriters(stage);
    adapter.step("writers-closed", stage);

    if (!replace && existsSync(request.target)) {
      if (equivalent(stage, request.target, kind) && isValid(request, request.target)) {
        return { target: request.target, outcome: "already-published" };
      }
      preserveEvidence = true;
      throw new PublicationCollisionError(request.target, stage);
    }

    renameSync(stage, request.target);
    adapter.step("published", request.target);
    validate(request, request.target);
    adapter.step("validated-after-publication", request.target);
    const fence = adapter.flushDirectory(parent);
    adapter.step(fence === "flushed" ? "parent-directory-flushed" : "parent-directory-flush-unsupported", parent);
    return { target: request.target, outcome: "published" };
  } finally {
    if (!preserveEvidence && existsSync(stage)) {
      rmSync(stage, { recursive: true, force: true });
      adapter.step("stage-cleaned", stage);
    }
  }
}

function validate(request: PublicationRequest, path: string): void {
  if (request.validate(path) === false) throw new Error(`Publication validation failed for ${path}`);
}

function isValid(request: PublicationRequest, path: string): boolean {
  try { validate(request, path); return true; } catch { return false; }
}

function assertCandidate(path: string, kind: "file" | "tree"): void {
  const stats = lstatSync(path);
  if (kind === "file" ? !stats.isFile() : !stats.isDirectory()) {
    throw new Error(`Publication candidate must be a regular ${kind}`);
  }
}

function regularFiles(root: string, kind: "file" | "tree"): string[] {
  if (kind === "file") return [root];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Validated trees cannot contain symbolic links");
    if (entry.isDirectory()) result.push(...regularFiles(path, "tree"));
    else if (entry.isFile()) result.push(path);
    else throw new Error("Validated trees may contain only directories and regular files");
  }
  return result;
}

function flushRegularFiles(root: string, kind: "file" | "tree", adapter: DurabilityPlatformAdapter): void {
  for (const path of regularFiles(root, kind)) adapter.flushFile(path);
}

function assertNoOpenWriters(root: string): void {
  // Windows enforces sharing at rename. On systems exposing procfs we can fail
  // earlier and, importantly, before publication when a materializer leaked a
  // descriptor. Other portable systems retain the callback-return ownership
  // boundary and still detect incompatible handles at rename.
  if (!existsSync("/proc/self/fd")) return;
  const candidate = statSync(root).isDirectory() ? `${root}/` : root;
  for (const descriptor of readdirSync("/proc/self/fd")) {
    let linked: string;
    try { linked = readlinkSync(join("/proc/self/fd", descriptor)).replace(/ \(deleted\)$/, ""); } catch { continue; }
    if (linked === root || linked.startsWith(candidate)) {
      throw new Error(`Publication materializer left a candidate writer open: ${linked}`);
    }
  }
}

function equivalent(left: string, right: string, kind: "file" | "tree"): boolean {
  try {
    if (kind === "file") return statSync(right).isFile() && readFileSync(left).equals(readFileSync(right));
    if (!statSync(right).isDirectory()) return false;
    const l = readdirSync(left).sort();
    const r = readdirSync(right).sort();
    return l.length === r.length && l.every((name, index) => name === r[index] && equivalent(join(left, name), join(right, name), lstatSync(join(left, name)).isDirectory() ? "tree" : "file"));
  } catch { return false; }
}

function createAdapter(
  platform: "windows" | "portable",
  options: DeterministicPublicationOptions = {},
): DurabilityPlatformAdapter {
  return {
    step(step, path) {
      options.onStep?.(step, path);
      if (options.failAt === step) throw new Error(`Injected publication failure at ${step}`);
    },
    flushFile(path) {
      // r+ is deliberate: Windows FlushFileBuffers requires a write-capable handle.
      const descriptor = openSync(path, "r+");
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    },
    flushDirectory(path) {
      if (platform === "windows") return "unsupported";
      const descriptor = openSync(path, "r");
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      return "flushed";
    },
  };
}

/** Convenience materializer for the common immutable-byte case. */
export function writeCandidate(bytes: string | Uint8Array): (stage: string) => void {
  return stage => writeFileSync(stage, bytes, { flag: "wx" });
}
