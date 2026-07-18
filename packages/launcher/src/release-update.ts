import { createHash, randomUUID, verify } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { z } from "zod";

const fileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const releaseManifestSchema = z
  .object({
    releaseId: z.string().min(1),
    protocolGeneration: z.string().min(1),
    daemonGeneration: z.string().min(1),
    workerGeneration: z.string().min(1),
    dataSchema: z.number().int().nonnegative(),
    files: z.array(fileSchema).min(1),
  })
  .strict();
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export class ReleaseUpdateError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "ReleaseUpdateError";
  }
}

export interface StagedRelease {
  state: "ready";
  manifest: ReleaseManifest;
  directory: string;
}

/** Verifies and publishes release bytes without ever making staging bytes runnable. */
export class SignedReleaseStore {
  constructor(readonly root: string, readonly pinnedSigningRoot: string | Buffer) {}

  stage(packageDirectory: string, metadata: Buffer, signature: Buffer): StagedRelease {
    if (!verify(null, metadata, this.pinnedSigningRoot, signature)) {
      throw new ReleaseUpdateError("signature-invalid");
    }
    let manifest: ReleaseManifest;
    try {
      manifest = releaseManifestSchema.parse(JSON.parse(metadata.toString("utf8")));
    } catch (cause) {
      throw new ReleaseUpdateError("metadata-invalid", String(cause));
    }
    if (manifest.daemonGeneration !== manifest.workerGeneration) {
      throw new ReleaseUpdateError("mixed-generation");
    }
    const names = new Set<string>();
    for (const file of manifest.files) {
      if (!safeRelative(file.path) || names.has(file.path)) {
        throw new ReleaseUpdateError("metadata-invalid");
      }
      names.add(file.path);
      const source = join(packageDirectory, file.path);
      if (!existsSync(source) || !statSync(source).isFile()) {
        throw new ReleaseUpdateError("package-incomplete");
      }
      const bytes = readFileSync(source);
      if (bytes.length !== file.size || digest(bytes) !== file.sha256) {
        throw new ReleaseUpdateError("package-corrupt");
      }
    }

    const releases = join(this.root, "releases");
    const destination = join(releases, safeId(manifest.releaseId));
    if (existsSync(destination)) {
      throw new ReleaseUpdateError("release-immutable");
    }
    const staging = join(this.root, ".release-staging", randomUUID());
    try {
      for (const file of manifest.files) {
        const target = join(staging, file.path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(packageDirectory, file.path), target);
        chmodSync(target, 0o444);
      }
      writeFileSync(join(staging, "release.json"), metadata, { flag: "wx", mode: 0o444 });
      writeFileSync(join(staging, "release.sig"), signature, { flag: "wx", mode: 0o444 });
      // Recheck copied bytes so a changing download cannot win the copy race.
      for (const file of manifest.files) {
        if (digest(readFileSync(join(staging, file.path))) !== file.sha256) {
          throw new ReleaseUpdateError("package-corrupt");
        }
      }
      mkdirSync(releases, { recursive: true });
      renameSync(staging, destination);
      makeDirectoriesReadOnly(destination);
      return { state: "ready", manifest, directory: destination };
    } catch (cause) {
      rmSync(staging, { recursive: true, force: true });
      throw cause;
    }
  }
}

export interface ActivationHooks {
  stopAcceptingMutations(): Promise<void> | void;
  resumeAcceptingMutations(): Promise<void> | void;
  isQuiescent(): Promise<boolean> | boolean;
  /** Must durably apply ordinary Session Stop semantics. */
  stopAffectedSessions(): Promise<void> | void;
  flushAndStopWorkers(): Promise<void> | void;
  activateData(manifest: ReleaseManifest): Promise<() => Promise<void> | void>;
  startMatchingRelease(release: StagedRelease): Promise<void>;
  hasAcceptedNewMutations(): Promise<boolean> | boolean;
  sleep?(milliseconds: number): Promise<void>;
  now?(): number;
}

/** Coordinates the Host-wide authority boundary; the pointer is the final commit. */
export async function activateSignedRelease(options: {
  root: string;
  release: StagedRelease;
  hooks: ActivationHooks;
  force?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const { hooks } = options;
  const timeout = options.timeoutMs ?? 15 * 60_000;
  const now = hooks.now ?? Date.now;
  const sleep = hooks.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const oldPointer = pointer(options.root);
  await hooks.stopAcceptingMutations();
  let rollbackData: (() => Promise<void> | void) | undefined;
  try {
    if (options.force) await hooks.stopAffectedSessions();
    const deadline = now() + timeout;
    while (!(await hooks.isQuiescent())) {
      if (now() >= deadline) throw new ReleaseUpdateError("quiescence-timeout");
      await sleep(Math.min(100, Math.max(1, deadline - now())));
    }
    await hooks.flushAndStopWorkers();
    rollbackData = await hooks.activateData(options.release.manifest);
    await hooks.startMatchingRelease(options.release);
    writePointer(options.root, options.release.manifest.releaseId);
  } catch (cause) {
    if (await hooks.hasAcceptedNewMutations()) {
      throw new ReleaseUpdateError("managed-restore-required", String(cause));
    }
    await rollbackData?.();
    if (oldPointer !== null) writePointer(options.root, oldPointer);
    throw cause;
  } finally {
    await hooks.resumeAcceptingMutations();
  }
}

function safeRelative(path: string): boolean {
  return path !== "." && !path.startsWith("/") && !path.split(/[\\/]/).includes("..") && resolve("/x", path).startsWith(`/x${sep}`);
}
function safeId(id: string): string {
  if (basename(id) !== id || id === "." || id === "..") throw new ReleaseUpdateError("metadata-invalid");
  return id;
}
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function makeDirectoriesReadOnly(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) makeDirectoriesReadOnly(join(root, entry.name));
  }
  // Keep directories owner-writable for managed release removal; files are
  // read-only and the store refuses replacement of a published release id.
  chmodSync(root, 0o755);
}
function pointer(root: string): string | null {
  const path = join(root, "active-release");
  return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
}
function writePointer(root: string, release: string): void {
  mkdirSync(root, { recursive: true });
  const target = join(root, "active-release");
  const staged = `${target}.${randomUUID()}.stage`;
  writeFileSync(staged, release, { flag: "wx" });
  renameSync(staged, target);
}
