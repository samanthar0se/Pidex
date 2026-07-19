import { createHash, verify } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface ReleaseManifest {
  schemaVersion: 1;
  releaseId: string;
  protocolGeneration: string;
  sbom: string;
  entrypoint: string;
  files: ReadonlyArray<{ path: string; sha256: string }>;
}

export interface PublishReleaseOptions {
  candidateDir: string;
  releasesDir: string;
  publicKey: string | Buffer;
}

/** Validate a downloaded candidate and publish it as one immutable directory. */
export function publishRunnableRelease(options: PublishReleaseOptions): string {
  const manifestBytes = readFileSync(join(options.candidateDir, "manifest.json"));
  const signature = readSignature(join(options.candidateDir, "manifest.sig"));
  if (!verify(null, manifestBytes, options.publicKey, signature)) {
    throw new Error("Release signature is invalid");
  }
  const manifest = parseManifest(manifestBytes.toString("utf8"));
  validateTree(options.candidateDir, manifest);

  mkdirSync(options.releasesDir, { recursive: true });
  const target = join(options.releasesDir, manifest.releaseId);
  const stage = join(
    options.releasesDir,
    `.candidate-${manifest.releaseId}-${process.pid}-${Date.now()}`,
  );
  cpSync(options.candidateDir, stage, { recursive: true, errorOnExist: true });
  validatePublishedTree(stage, manifest, options.publicKey);
  try {
    renameSync(stage, target);
  } catch (error) {
    if (existsSync(target) && equivalentTrees(target, stage)) {
      rmSync(stage, { recursive: true });
      return target;
    }
    // Keep the stage: it is useful collision/publication evidence.
    throw new Error(`Release ${manifest.releaseId} collides with published content`, {
      cause: error,
    });
  }
  validatePublishedTree(target, manifest, options.publicKey);
  return target;
}

function validatePublishedTree(
  directory: string,
  expected: ReleaseManifest,
  publicKey: string | Buffer,
): void {
  const bytes = readFileSync(join(directory, "manifest.json"));
  if (!verify(null, bytes, publicKey, readSignature(join(directory, "manifest.sig")))) {
    throw new Error("Published release signature is invalid");
  }
  const actual = parseManifest(bytes.toString("utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Published release manifest changed");
  }
  validateTree(directory, actual);
}

function validateTree(directory: string, manifest: ReleaseManifest): void {
  const declared = new Set<string>();
  for (const file of manifest.files) {
    const path = safeRelativePath(file.path);
    if (declared.has(path)) throw new Error(`Duplicate release file: ${path}`);
    declared.add(path);
    const absolute = join(directory, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`Release file is missing: ${path}`);
    }
    const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    if (digest !== file.sha256.toLowerCase()) {
      throw new Error(`Release file digest is invalid: ${path}`);
    }
  }
  if (!declared.has(safeRelativePath(manifest.sbom))) {
    throw new Error("Release SBOM is not declared");
  }
  if (!declared.has(safeRelativePath(manifest.entrypoint))) {
    throw new Error("Release entrypoint is not declared");
  }
  const actual = listFiles(directory).filter(
    path => path !== "manifest.json" && path !== "manifest.sig",
  );
  if (actual.some(path => !declared.has(path))) {
    throw new Error("Release contains undeclared or mixed-generation files");
  }
}

function parseManifest(serialized: string): ReleaseManifest {
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== "object" || value === null ||
    !("schemaVersion" in value) || value.schemaVersion !== 1 ||
    !("releaseId" in value) || typeof value.releaseId !== "string" || !/^[A-Za-z0-9._@-]+$/.test(value.releaseId) ||
    !("protocolGeneration" in value) || typeof value.protocolGeneration !== "string" || value.protocolGeneration.length === 0 ||
    !("sbom" in value) || typeof value.sbom !== "string" ||
    !("entrypoint" in value) || typeof value.entrypoint !== "string" ||
    !("files" in value) || !Array.isArray(value.files) ||
    !value.files.every(file => typeof file === "object" && file !== null && "path" in file && typeof file.path === "string" && "sha256" in file && typeof file.sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(file.sha256))
  ) throw new Error("Release manifest is invalid");
  return value as ReleaseManifest;
}

function safeRelativePath(path: string): string {
  if (!path || resolve("/release", path) === "/release" || resolve("/release", path).startsWith(`/release${sep}`) === false || path.includes("\\")) {
    throw new Error(`Unsafe release path: ${path}`);
  }
  return relative("/release", resolve("/release", path)).split(sep).join("/");
}

function listFiles(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Release symlinks are forbidden");
    return entry.isDirectory() ? listFiles(root, absolute) : [relative(root, absolute).split(sep).join("/")];
  }).sort();
}

function readSignature(path: string): Buffer {
  const text = readFileSync(path, "utf8").trim();
  return Buffer.from(text, "base64");
}

function equivalentTrees(left: string, right: string): boolean {
  const leftFiles = listFiles(left);
  const rightFiles = listFiles(right);
  return JSON.stringify(leftFiles) === JSON.stringify(rightFiles) && leftFiles.every(path => readFileSync(join(left, path)).equals(readFileSync(join(right, path))));
}

export class UncertainReleaseActivationError extends Error {}

export interface ReleaseActivationOperations {
  stopMutationAcceptance(): Promise<void>;
  reachQuiescence(): Promise<void>;
  activateAuthority(releaseId: string, protocolGeneration: string): Promise<{ generation: string }>;
  startRelease(releaseId: string, authorityGeneration: string): Promise<{ releaseId: string; authorityGeneration: string }>;
  replaceReleaseSelector(releaseId: string): Promise<void>;
  rollbackAuthority(): Promise<void>;
  resumePriorRelease(): Promise<void>;
  restoreMutationAcceptance(): Promise<void>;
}

/** Selector replacement is the final commit point; uncertain activation is never guessed. */
export async function activateRunnableRelease(
  manifest: Pick<ReleaseManifest, "releaseId" | "protocolGeneration">,
  operations: ReleaseActivationOperations,
): Promise<void> {
  let authorityActivated = false;
  let selectorReplacementStarted = false;
  try {
    await operations.stopMutationAcceptance();
    await operations.reachQuiescence();
    const authority = await operations.activateAuthority(manifest.releaseId, manifest.protocolGeneration);
    authorityActivated = true;
    const ready = await operations.startRelease(manifest.releaseId, authority.generation);
    if (ready.releaseId !== manifest.releaseId || ready.authorityGeneration !== authority.generation) {
      throw new Error("Release readiness does not match activated Authority");
    }
    selectorReplacementStarted = true;
    await operations.replaceReleaseSelector(manifest.releaseId);
  } catch (error) {
    if (error instanceof UncertainReleaseActivationError) throw error;
    if (selectorReplacementStarted) {
      throw new UncertainReleaseActivationError(
        "Release selector outcome is uncertain; refusing to guess",
        { cause: error },
      );
    }
    if (authorityActivated) await operations.rollbackAuthority();
    await operations.resumePriorRelease();
    await operations.restoreMutationAcceptance();
    throw error;
  }
}
