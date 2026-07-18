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

const DEFAULT_QUIESCENCE_TIMEOUT_MS = 15 * 60_000;
const QUIESCENCE_POLL_INTERVAL_MS = 100;

const fileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const sbomSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.literal("cyclonedx-json-1.5"),
});

export const releaseManifestSchema = z
  .object({
    releaseId: z.string().min(1),
    protocolGeneration: z.string().min(1),
    daemonGeneration: z.string().min(1),
    workerGeneration: z.string().min(1),
    dataSchema: z.number().int().nonnegative(),
    files: z.array(fileSchema).min(1),
    sbom: sbomSchema,
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
  constructor(
    readonly root: string,
    readonly pinnedSigningRoot: string | Buffer,
  ) {}

  stage(
    packageDirectory: string,
    metadata: Buffer,
    signature: Buffer,
  ): StagedRelease {
    if (!verify(null, metadata, this.pinnedSigningRoot, signature)) {
      throw new ReleaseUpdateError("signature-invalid");
    }

    const manifest = parseReleaseManifest(metadata);
    if (manifest.daemonGeneration !== manifest.workerGeneration) {
      throw new ReleaseUpdateError("mixed-generation");
    }

    validateReleaseFiles(packageDirectory, manifest);
    validateSbom(packageDirectory, manifest);

    const releasesDirectory = join(this.root, "releases");
    const releaseDirectory = join(
      releasesDirectory,
      validateReleaseId(manifest.releaseId),
    );
    if (existsSync(releaseDirectory)) {
      throw new ReleaseUpdateError("release-immutable");
    }

    const stagingDirectory = join(
      this.root,
      ".release-staging",
      randomUUID(),
    );
    try {
      for (const file of manifest.files) {
        const target = join(stagingDirectory, file.path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(packageDirectory, file.path), target);
        chmodSync(target, 0o444);
      }

      writeFileSync(join(stagingDirectory, "release.json"), metadata, {
        flag: "wx",
        mode: 0o444,
      });
      writeFileSync(join(stagingDirectory, "release.sig"), signature, {
        flag: "wx",
        mode: 0o444,
      });

      // Recheck copied bytes so a changing download cannot win the copy race.
      for (const file of manifest.files) {
        const stagedBytes = readFileSync(join(stagingDirectory, file.path));
        if (sha256(stagedBytes) !== file.sha256) {
          throw new ReleaseUpdateError("package-corrupt");
        }
      }

      mkdirSync(releasesDirectory, { recursive: true });
      renameSync(stagingDirectory, releaseDirectory);
      setPublishedDirectoryPermissions(releaseDirectory);
      return { state: "ready", manifest, directory: releaseDirectory };
    } catch (cause) {
      rmSync(stagingDirectory, { recursive: true, force: true });
      throw cause;
    }
  }
}

function validateSbom(
  packageDirectory: string,
  manifest: ReleaseManifest,
): void {
  if (!manifest.files.some(file => file.path === manifest.sbom.path)) {
    throw new ReleaseUpdateError("sbom-unlinked");
  }
  const bytes = readFileSync(join(packageDirectory, manifest.sbom.path));
  if (sha256(bytes) !== manifest.sbom.sha256) {
    throw new ReleaseUpdateError("sbom-invalid");
  }
  try {
    const document = z
      .object({
        bomFormat: z.literal("CycloneDX"),
        specVersion: z.literal("1.5"),
        serialNumber: z.string().startsWith("urn:uuid:"),
        version: z.number().int().positive(),
        components: z.array(z.object({}).passthrough()),
      })
      .passthrough()
      .parse(JSON.parse(bytes.toString("utf8")));
    if (document.components.length === 0) {
      throw new Error("empty");
    }
  } catch (cause) {
    throw new ReleaseUpdateError("sbom-invalid", String(cause));
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

export interface ActivateSignedReleaseOptions {
  root: string;
  release: StagedRelease;
  hooks: ActivationHooks;
  force?: boolean;
  timeoutMs?: number;
}

/** Coordinates the Host-wide authority boundary; the pointer is the final commit. */
export async function activateSignedRelease(
  options: ActivateSignedReleaseOptions,
): Promise<void> {
  const { hooks } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUIESCENCE_TIMEOUT_MS;
  const now = hooks.now ?? Date.now;
  const sleep =
    hooks.sleep ??
    (milliseconds =>
      new Promise(resolve => setTimeout(resolve, milliseconds)));
  const previousReleaseId = readActiveRelease(options.root);

  await hooks.stopAcceptingMutations();
  let rollbackData: (() => Promise<void> | void) | undefined;
  try {
    if (options.force) {
      await hooks.stopAffectedSessions();
    }

    const deadline = now() + timeoutMs;
    while (!(await hooks.isQuiescent())) {
      if (now() >= deadline) {
        throw new ReleaseUpdateError("quiescence-timeout");
      }
      await sleep(
        Math.min(
          QUIESCENCE_POLL_INTERVAL_MS,
          Math.max(1, deadline - now()),
        ),
      );
    }

    await hooks.flushAndStopWorkers();
    rollbackData = await hooks.activateData(options.release.manifest);
    await hooks.startMatchingRelease(options.release);
    writeActiveRelease(options.root, options.release.manifest.releaseId);
  } catch (cause) {
    if (await hooks.hasAcceptedNewMutations()) {
      throw new ReleaseUpdateError(
        "managed-restore-required",
        String(cause),
      );
    }
    await rollbackData?.();
    if (previousReleaseId !== null) {
      writeActiveRelease(options.root, previousReleaseId);
    }
    throw cause;
  } finally {
    await hooks.resumeAcceptingMutations();
  }
}

function parseReleaseManifest(metadata: Buffer): ReleaseManifest {
  try {
    return releaseManifestSchema.parse(
      JSON.parse(metadata.toString("utf8")),
    );
  } catch (cause) {
    throw new ReleaseUpdateError("metadata-invalid", String(cause));
  }
}

function validateReleaseFiles(
  packageDirectory: string,
  manifest: ReleaseManifest,
): void {
  const filePaths = new Set<string>();
  for (const file of manifest.files) {
    if (!isSafeRelativePath(file.path) || filePaths.has(file.path)) {
      throw new ReleaseUpdateError("metadata-invalid");
    }
    filePaths.add(file.path);

    const source = join(packageDirectory, file.path);
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new ReleaseUpdateError("package-incomplete");
    }

    const bytes = readFileSync(source);
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
      throw new ReleaseUpdateError("package-corrupt");
    }
  }
}

function isSafeRelativePath(path: string): boolean {
  if (path === "." || path.startsWith("/")) {
    return false;
  }
  if (path.split(/[\\/]/).includes("..")) {
    return false;
  }
  return resolve("/x", path).startsWith(`/x${sep}`);
}

function validateReleaseId(id: string): string {
  if (basename(id) !== id || id === "." || id === "..") {
    throw new ReleaseUpdateError("metadata-invalid");
  }
  return id;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function setPublishedDirectoryPermissions(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      setPublishedDirectoryPermissions(join(root, entry.name));
    }
  }

  // Keep directories owner-writable for managed release removal; files are
  // read-only and the store refuses replacement of a published release id.
  chmodSync(root, 0o755);
}

function readActiveRelease(root: string): string | null {
  const path = join(root, "active-release");
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8").trim();
}

function writeActiveRelease(root: string, releaseId: string): void {
  mkdirSync(root, { recursive: true });
  const target = join(root, "active-release");
  const stagedPointer = `${target}.${randomUUID()}.stage`;
  writeFileSync(stagedPointer, releaseId, { flag: "wx" });
  renameSync(stagedPointer, target);
}
