import { createHash } from "node:crypto";
import { win32 } from "node:path";
import { z } from "zod";

export {
  assertCompleteTraceability,
  evaluateTraceability,
  traceabilityManifestSchema,
} from "./traceability.js";
export type {
  TraceabilityCatalog,
  TraceabilityManifest,
  TraceabilityResult,
  TraceabilitySource,
} from "./traceability.js";
export {
  hostCompatibilityRecordSchema,
  parseHostCompatibilityRecord,
} from "./compatibility.js";
export type { HostCompatibilityRecord } from "./compatibility.js";

const REAL_CANONICAL_PORT = 47831;
const PINNED_PI_VERSION = "0.80.10";

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "expected lowercase SHA-256");
const generationSchema = z.number().int().nonnegative();
const absolutePathSchema = z
  .string()
  .min(1)
  .refine((path) => win32.isAbsolute(path), "path must be absolute");
const artifactSchema = z.strictObject({
  path: absolutePathSchema,
  sha256: sha256Schema,
});

const rootRolesSchema = z.strictObject({
  instanceIdentity: absolutePathSchema,
  controlCredential: absolutePathSchema,
  authorityGenerations: absolutePathSchema,
  generationSelectors: absolutePathSchema,
  immutableBlobs: absolutePathSchema,
  checkpointChunks: absolutePathSchema,
  checkpointManifests: absolutePathSchema,
  workerState: absolutePathSchema,
  migrationStaging: absolutePathSchema,
  recoverySnapshots: absolutePathSchema,
  managedBackups: absolutePathSchema,
  diagnostics: absolutePathSchema,
  launcherState: absolutePathSchema,
  tlsState: absolutePathSchema,
  publicationTemp: absolutePathSchema,
});

const artifactsSchema = z.strictObject({
  launcher: artifactSchema,
  node: artifactSchema,
  daemon: artifactSchema,
  worker: artifactSchema,
  addon: artifactSchema,
  companion: artifactSchema,
  schemas: artifactSchema,
  certificateTool: artifactSchema,
  maintenance: artifactSchema,
});

const provenanceEntrySchema = z.strictObject({
  kind: z.enum([
    "default",
    "source-config",
    "cli-override",
    "prepared-state",
    "release-closure",
  ]),
  detail: z.string().min(1).max(500),
});

const launchManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  identity: z.strictObject({
    instanceId: z.string().min(1).max(200),
    owningSid: z.string().regex(/^S-1-(?:\d+-)+\d+$/),
    trustClass: z.enum(["source", "installed"]),
  }),
  generations: z.strictObject({
    release: z.string().min(1),
    daemon: generationSchema,
    worker: generationSchema,
    publicProtocol: generationSchema,
    localControl: generationSchema,
    capability: generationSchema,
    addon: generationSchema,
    schema: generationSchema,
  }),
  endpoints: z.strictObject({
    canonicalOrigin: z
      .string()
      .url()
      .refine(
        (value) => value.startsWith("https://"),
        "canonical origin must use HTTPS",
      ),
    canonicalPort: z.number().int().min(1).max(65535),
    localControl: z
      .string()
      .regex(
        /^\\\\\.\\pipe\\[^\\]+$/,
        "local control must be a local named pipe",
      ),
  }),
  roots: z.strictObject({
    sourceInstance: absolutePathSchema,
    roles: rootRolesSchema,
  }),
  artifacts: artifactsSchema,
  piProfile: z.strictObject({
    policy: z.enum(["owning-user-standard", "synthetic-isolated"]),
    version: z.string().min(1),
  }),
  runtimes: z.strictObject({
    node: z.strictObject({
      lane: z.enum(["primary", "secondary"]),
      version: z.string().min(1),
      architecture: z.literal("x64"),
      sha256: sha256Schema,
    }),
    nodeApi: generationSchema,
    pi: z.strictObject({
      version: z.string().min(1),
      integrity: z.string().min(1),
    }),
    addonAbi: z.string().min(1),
    toolchain: z.strictObject({
      msvc: z.string().min(1),
      windowsSdk: z.string().min(1),
      cmake: z.string().min(1),
      cpp: z.literal("20"),
    }),
  }),
  compatibility: z.strictObject({
    daemonWorker: z.array(generationSchema).min(1),
    publicProtocol: z.array(generationSchema).min(1),
    localControl: z.array(generationSchema).min(1),
    capability: z.array(generationSchema).min(1),
    addon: z.array(generationSchema).min(1),
    schema: z.array(generationSchema).min(1),
    piArtifacts: z.array(
      z.strictObject({
        from: generationSchema,
        to: generationSchema,
        converterArtifact: z.literal("maintenance"),
      }),
    ),
  }),
  closure: z.strictObject({
    id: z.string().min(1),
    sbom: artifactSchema,
  }),
  execution: z.strictObject({
    implementation: z.enum(["real", "deterministic"]),
    evidenceClass: z.enum([
      "local-source",
      "installed-signed",
      "deterministic-test",
    ]),
  }),
  provenance: z.record(z.string().min(1), provenanceEntrySchema),
});

type LaunchManifest = z.infer<typeof launchManifestSchema>;

export const resolvedLaunchManifestSchema = launchManifestSchema.superRefine(
  validateManifestRelationships,
);

export type ResolvedLaunchManifest = z.infer<
  typeof resolvedLaunchManifestSchema
>;

export function parseResolvedLaunchManifest(
  input: unknown,
): ResolvedLaunchManifest {
  return resolvedLaunchManifestSchema.parse(input);
}

/** Stable UTF-8 JSON input for hashing and byte-for-byte transfer between runtime components. */
export function canonicalizeResolvedLaunchManifest(
  manifest: ResolvedLaunchManifest,
): string {
  const validatedManifest = parseResolvedLaunchManifest(manifest);
  return JSON.stringify(sortObjectKeys(validatedManifest));
}

function validateManifestRelationships(
  manifest: LaunchManifest,
  context: z.core.$RefinementCtx,
): void {
  validatePathRelationships(manifest, context);
  validateExecutionRelationships(manifest, context);
  validateRuntimeCompatibility(manifest, context);
}

function validatePathRelationships(
  manifest: LaunchManifest,
  context: z.core.$RefinementCtx,
): void {
  const sourceInstanceRoot = normalizeWindowsPath(
    manifest.roots.sourceInstance,
  );
  const expectedRootPart =
    manifest.identity.trustClass === "source"
      ? "\\pidex\\source\\"
      : "\\pidex\\installed\\";

  if (!sourceInstanceRoot.includes(expectedRootPart)) {
    addValidationIssue(
      context,
      ["identity", "trustClass"],
      "trust class does not match its profile root",
    );
  }

  const normalizedRolePaths = Object.values(manifest.roots.roles).map(
    normalizeWindowsPath,
  );
  for (const [role, path] of Object.entries(manifest.roots.roles)) {
    if (!isDescendantOf(sourceInstanceRoot, normalizeWindowsPath(path))) {
      addValidationIssue(
        context,
        ["roots", "roles", role],
        "root crossover outside the selected instance",
      );
    }
  }

  if (new Set(normalizedRolePaths).size !== normalizedRolePaths.length) {
    addValidationIssue(
      context,
      ["roots", "roles"],
      "root roles must be distinct",
    );
  }

  for (const [role, artifact] of Object.entries(manifest.artifacts)) {
    if (
      !isDescendantOf(sourceInstanceRoot, normalizeWindowsPath(artifact.path))
    ) {
      addValidationIssue(
        context,
        ["artifacts", role, "path"],
        "artifact crossover outside the selected instance",
      );
    }
  }

  if (
    !isDescendantOf(
      sourceInstanceRoot,
      normalizeWindowsPath(manifest.closure.sbom.path),
    )
  ) {
    addValidationIssue(
      context,
      ["closure", "sbom", "path"],
      "SBOM crossover outside the selected instance",
    );
  }
}

function validateExecutionRelationships(
  manifest: LaunchManifest,
  context: z.core.$RefinementCtx,
): void {
  if (manifest.execution.implementation === "real") {
    if (manifest.piProfile.policy !== "owning-user-standard") {
      addValidationIssue(
        context,
        ["piProfile"],
        "real execution requires the owning user's standard Pi profile",
      );
    }
    if (manifest.endpoints.canonicalPort !== REAL_CANONICAL_PORT) {
      addValidationIssue(
        context,
        ["endpoints", "canonicalPort"],
        `real execution requires fixed canonical port ${REAL_CANONICAL_PORT}`,
      );
    }
    if (manifest.execution.evidenceClass === "deterministic-test") {
      addValidationIssue(
        context,
        ["execution"],
        "real execution cannot claim deterministic evidence",
      );
    }
  } else if (
    manifest.identity.trustClass !== "source" ||
    manifest.execution.evidenceClass !== "deterministic-test"
  ) {
    addValidationIssue(
      context,
      ["execution"],
      "deterministic execution is restricted to isolated source test manifests",
    );
  }

  if (
    manifest.identity.trustClass === "source" &&
    manifest.execution.evidenceClass === "installed-signed"
  ) {
    addValidationIssue(
      context,
      ["execution"],
      "source trust class cannot claim installed evidence",
    );
  }
  if (
    manifest.identity.trustClass === "installed" &&
    manifest.execution.evidenceClass !== "installed-signed"
  ) {
    addValidationIssue(
      context,
      ["execution"],
      "installed trust class requires installed evidence",
    );
  }
}

function validateRuntimeCompatibility(
  manifest: LaunchManifest,
  context: z.core.$RefinementCtx,
): void {
  if (manifest.runtimes.pi.version !== manifest.piProfile.version) {
    addValidationIssue(
      context,
      ["runtimes", "pi"],
      "Pi generation/version mismatch",
    );
  }
  if (manifest.runtimes.pi.version !== PINNED_PI_VERSION) {
    addValidationIssue(
      context,
      ["runtimes", "pi", "version"],
      `Pi version must be exactly ${PINNED_PI_VERSION}`,
    );
  }
  if (manifest.runtimes.addonAbi !== `napi-${manifest.runtimes.nodeApi}`) {
    addValidationIssue(
      context,
      ["runtimes", "addonAbi"],
      "addon ABI does not match the declared Node-API level",
    );
  }
  if (manifest.runtimes.node.sha256 !== manifest.artifacts.node.sha256) {
    addValidationIssue(
      context,
      ["runtimes", "node", "sha256"],
      "Node runtime hash does not match the closure artifact",
    );
  }

  const compatibilityChecks = [
    ["daemonWorker", manifest.generations.worker],
    ["publicProtocol", manifest.generations.publicProtocol],
    ["localControl", manifest.generations.localControl],
    ["capability", manifest.generations.capability],
    ["addon", manifest.generations.addon],
    ["schema", manifest.generations.schema],
  ] as const;

  for (const [field, currentGeneration] of compatibilityChecks) {
    if (!manifest.compatibility[field].includes(currentGeneration)) {
      addValidationIssue(
        context,
        ["compatibility", field],
        `generation ${currentGeneration} is incompatible`,
      );
    }
  }
}

export interface ClosureReader {
  /** Returns every file in the selected closure as an absolute path. */
  listFiles(): Promise<readonly string[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Must check the platform's publication boundary, not merely an open handle. */
  isImmutable(path: string): Promise<boolean>;
}

export interface ClosureCompatibilityEvidence {
  schemaVersion: 1;
  closureId: string;
  manifestSha256: string;
  closureSha256: string;
  node: {
    lane: "primary" | "secondary";
    version: string;
    architecture: "x64";
    nodeApi: number;
    sha256: string;
  };
  pi: { version: "0.80.10"; integrity: string };
  addon: { abi: string; generation: number; sha256: string };
  generations: Omit<ResolvedLaunchManifest["generations"], "release">;
  toolchain: ResolvedLaunchManifest["runtimes"]["toolchain"];
}

/**
 * Verifies the selected publication as one exact, immutable closure. The reader
 * keeps platform-specific immutability policy at the publication boundary.
 */
export async function verifyImmutableClosure(
  input: ResolvedLaunchManifest,
  reader: ClosureReader,
): Promise<ClosureCompatibilityEvidence> {
  const manifest = parseResolvedLaunchManifest(input);
  const declaredArtifacts = [
    ...Object.values(manifest.artifacts),
    manifest.closure.sbom,
  ];
  const declaredArtifactsByPath = new Map(
    declaredArtifacts.map((artifact) => [
      normalizeWindowsPath(artifact.path),
      artifact,
    ]),
  );
  if (declaredArtifactsByPath.size !== declaredArtifacts.length) {
    throw new Error("Closure contains duplicate declared paths");
  }

  const listedFiles = (await reader.listFiles()).map((path) => ({
    originalPath: path,
    normalizedPath: normalizeWindowsPath(path),
  }));
  const listedPaths = new Set(
    listedFiles.map((file) => file.normalizedPath),
  );
  if (listedPaths.size !== listedFiles.length) {
    throw new Error("Closure contains duplicate files");
  }

  for (const path of declaredArtifactsByPath.keys()) {
    if (!listedPaths.has(path)) {
      throw new Error(`Closure file is missing: ${path}`);
    }
  }

  const matchedFiles = listedFiles.map((file) => {
    const declaredArtifact = declaredArtifactsByPath.get(file.normalizedPath);
    if (declaredArtifact === undefined) {
      throw new Error(
        `Closure contains undeclared content: ${file.originalPath}`,
      );
    }
    return { ...file, declaredArtifact };
  });

  const verifiedFiles: Array<{ path: string; sha256: string }> = [];
  for (const file of matchedFiles.sort((left, right) =>
    left.normalizedPath.localeCompare(right.normalizedPath),
  )) {
    if (!(await reader.isImmutable(file.originalPath))) {
      throw new Error(`Closure file is mutable: ${file.originalPath}`);
    }
    const digest = sha256(await reader.readFile(file.originalPath));
    if (digest !== file.declaredArtifact.sha256) {
      throw new Error(`Closure file hash mismatch: ${file.originalPath}`);
    }
    verifiedFiles.push({ path: file.normalizedPath, sha256: digest });
  }

  const generations = {
    daemon: manifest.generations.daemon,
    worker: manifest.generations.worker,
    publicProtocol: manifest.generations.publicProtocol,
    localControl: manifest.generations.localControl,
    capability: manifest.generations.capability,
    addon: manifest.generations.addon,
    schema: manifest.generations.schema,
  };
  return {
    schemaVersion: 1,
    closureId: manifest.closure.id,
    manifestSha256: sha256(
      Buffer.from(canonicalizeResolvedLaunchManifest(manifest)),
    ),
    closureSha256: sha256(Buffer.from(JSON.stringify(verifiedFiles))),
    node: { ...manifest.runtimes.node, nodeApi: manifest.runtimes.nodeApi },
    pi: {
      version: PINNED_PI_VERSION,
      integrity: manifest.runtimes.pi.integrity,
    },
    addon: {
      abi: manifest.runtimes.addonAbi,
      generation: manifest.generations.addon,
      sha256: manifest.artifacts.addon.sha256,
    },
    generations,
    toolchain: manifest.runtimes.toolchain,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeWindowsPath(path: string): string {
  return win32.normalize(path).toLowerCase().replace(/\\$/, "");
}

function isDescendantOf(root: string, path: string): boolean {
  return path.startsWith(`${root}\\`);
}

function addValidationIssue(
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, child]) => [key, sortObjectKeys(child)]),
    );
  }
  return value;
}
