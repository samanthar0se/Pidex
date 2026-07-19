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

const RELEASE_ID_PATTERN = /^[A-Za-z0-9._@-]+$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const RELEASE_ROOT = "/release";

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
  const targetDirectory = join(options.releasesDir, manifest.releaseId);
  const stagingDirectory = join(
    options.releasesDir,
    `.candidate-${manifest.releaseId}-${process.pid}-${Date.now()}`,
  );
  cpSync(options.candidateDir, stagingDirectory, {
    recursive: true,
    errorOnExist: true,
  });
  validatePublishedTree(stagingDirectory, manifest, options.publicKey);

  try {
    renameSync(stagingDirectory, targetDirectory);
  } catch (error) {
    if (
      existsSync(targetDirectory) &&
      equivalentTrees(targetDirectory, stagingDirectory)
    ) {
      rmSync(stagingDirectory, { recursive: true });
      return targetDirectory;
    }

    // Preserve the staging directory as collision/publication evidence.
    throw new Error(
      `Release ${manifest.releaseId} collides with published content`,
      { cause: error },
    );
  }

  validatePublishedTree(targetDirectory, manifest, options.publicKey);
  return targetDirectory;
}

function validatePublishedTree(
  directory: string,
  expectedManifest: ReleaseManifest,
  publicKey: string | Buffer,
): void {
  const manifestBytes = readFileSync(join(directory, "manifest.json"));
  const signature = readSignature(join(directory, "manifest.sig"));
  if (!verify(null, manifestBytes, publicKey, signature)) {
    throw new Error("Published release signature is invalid");
  }

  const manifest = parseManifest(manifestBytes.toString("utf8"));
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) {
    throw new Error("Published release manifest changed");
  }
  validateTree(directory, manifest);
}

function validateTree(directory: string, manifest: ReleaseManifest): void {
  const declaredFiles = new Set<string>();

  for (const file of manifest.files) {
    const path = safeRelativePath(file.path);
    if (declaredFiles.has(path)) {
      throw new Error(`Duplicate release file: ${path}`);
    }
    declaredFiles.add(path);

    const absolutePath = join(directory, path);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`Release file is missing: ${path}`);
    }

    const digest = createHash("sha256")
      .update(readFileSync(absolutePath))
      .digest("hex");
    if (digest !== file.sha256.toLowerCase()) {
      throw new Error(`Release file digest is invalid: ${path}`);
    }
  }

  if (!declaredFiles.has(safeRelativePath(manifest.sbom))) {
    throw new Error("Release SBOM is not declared");
  }
  if (!declaredFiles.has(safeRelativePath(manifest.entrypoint))) {
    throw new Error("Release entrypoint is not declared");
  }

  const actualFiles = listFiles(directory).filter(
    path => path !== "manifest.json" && path !== "manifest.sig",
  );
  if (actualFiles.some(path => !declaredFiles.has(path))) {
    throw new Error("Release contains undeclared or mixed-generation files");
  }
}

function parseManifest(serialized: string): ReleaseManifest {
  const value: unknown = JSON.parse(serialized);
  if (!isReleaseManifest(value)) {
    throw new Error("Release manifest is invalid");
  }

  return value;
}

function isReleaseManifest(value: unknown): value is ReleaseManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "schemaVersion" in value &&
    value.schemaVersion === 1 &&
    "releaseId" in value &&
    typeof value.releaseId === "string" &&
    RELEASE_ID_PATTERN.test(value.releaseId) &&
    "protocolGeneration" in value &&
    typeof value.protocolGeneration === "string" &&
    value.protocolGeneration.length > 0 &&
    "sbom" in value &&
    typeof value.sbom === "string" &&
    "entrypoint" in value &&
    typeof value.entrypoint === "string" &&
    "files" in value &&
    Array.isArray(value.files) &&
    value.files.every(isReleaseManifestFile)
  );
}

function isReleaseManifestFile(
  value: unknown,
): value is ReleaseManifest["files"][number] {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "sha256" in value &&
    typeof value.sha256 === "string" &&
    SHA256_PATTERN.test(value.sha256)
  );
}

function safeRelativePath(path: string): string {
  const absolutePath = resolve(RELEASE_ROOT, path);
  const isWithinRelease = absolutePath.startsWith(`${RELEASE_ROOT}${sep}`);
  if (
    !path ||
    absolutePath === RELEASE_ROOT ||
    !isWithinRelease ||
    path.includes("\\")
  ) {
    throw new Error(`Unsafe release path: ${path}`);
  }

  return relative(RELEASE_ROOT, absolutePath).split(sep).join("/");
}

function listFiles(root: string, directory = root): string[] {
  const files = readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("Release symlinks are forbidden");
    }
    if (entry.isDirectory()) {
      return listFiles(root, absolutePath);
    }

    return [relative(root, absolutePath).split(sep).join("/")];
  });

  return files.sort();
}

function readSignature(path: string): Buffer {
  const text = readFileSync(path, "utf8").trim();
  return Buffer.from(text, "base64");
}

function equivalentTrees(left: string, right: string): boolean {
  const leftFiles = listFiles(left);
  const rightFiles = listFiles(right);
  return (
    JSON.stringify(leftFiles) === JSON.stringify(rightFiles) &&
    leftFiles.every(path =>
      readFileSync(join(left, path)).equals(readFileSync(join(right, path))),
    )
  );
}

export class UncertainReleaseActivationError extends Error {}

export interface ReleaseActivationOperations {
  stopMutationAcceptance(): Promise<void>;
  reachQuiescence(): Promise<void>;
  activateAuthority(
    releaseId: string,
    protocolGeneration: string,
  ): Promise<{ generation: string }>;
  startRelease(
    releaseId: string,
    authorityGeneration: string,
  ): Promise<{ releaseId: string; authorityGeneration: string }>;
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
    const authority = await operations.activateAuthority(
      manifest.releaseId,
      manifest.protocolGeneration,
    );
    authorityActivated = true;
    const readiness = await operations.startRelease(
      manifest.releaseId,
      authority.generation,
    );
    if (
      readiness.releaseId !== manifest.releaseId ||
      readiness.authorityGeneration !== authority.generation
    ) {
      throw new Error("Release readiness does not match activated Authority");
    }

    selectorReplacementStarted = true;
    await operations.replaceReleaseSelector(manifest.releaseId);
  } catch (error) {
    if (error instanceof UncertainReleaseActivationError) {
      throw error;
    }
    if (selectorReplacementStarted) {
      throw new UncertainReleaseActivationError(
        "Release selector outcome is uncertain; refusing to guess",
        { cause: error },
      );
    }
    if (authorityActivated) {
      await operations.rollbackAuthority();
    }
    await operations.resumePriorRelease();
    await operations.restoreMutationAcceptance();
    throw error;
  }
}
