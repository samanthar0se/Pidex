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

const REAL_CANONICAL_PORT = 47831;

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
