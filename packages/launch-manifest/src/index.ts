import { win32 } from "node:path";
import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected lowercase SHA-256");
const generation = z.number().int().nonnegative();
const absolutePath = z.string().min(1).refine(value => win32.isAbsolute(value), "path must be absolute");
const artifact = z.strictObject({ path: absolutePath, sha256 });
const rootRoles = [
  "instanceIdentity", "controlCredential", "authorityGenerations", "generationSelectors",
  "immutableBlobs", "checkpointChunks", "checkpointManifests", "workerState",
  "migrationStaging", "recoverySnapshots", "managedBackups", "diagnostics",
  "launcherState", "tlsState", "publicationTemp",
] as const;
const artifactRoles = [
  "launcher", "node", "daemon", "worker", "addon", "companion", "schemas",
  "certificateTool", "maintenance",
] as const;

const rolesSchema = z.strictObject(Object.fromEntries(rootRoles.map(role => [role, absolutePath])) as Record<(typeof rootRoles)[number], typeof absolutePath>);
const artifactsSchema = z.strictObject(Object.fromEntries(artifactRoles.map(role => [role, artifact])) as Record<(typeof artifactRoles)[number], typeof artifact>);
const provenanceEntry = z.strictObject({
  kind: z.enum(["default", "source-config", "cli-override", "prepared-state", "release-closure"]),
  detail: z.string().min(1).max(500),
});

export const resolvedLaunchManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  identity: z.strictObject({ instanceId: z.string().min(1).max(200), owningSid: z.string().regex(/^S-1-(?:\d+-)+\d+$/), trustClass: z.enum(["source", "installed"]) }),
  generations: z.strictObject({ release: z.string().min(1), daemon: generation, worker: generation, publicProtocol: generation, localControl: generation, capability: generation, addon: generation, schema: generation }),
  endpoints: z.strictObject({ canonicalOrigin: z.string().url().refine(value => value.startsWith("https://"), "canonical origin must use HTTPS"), canonicalPort: z.number().int().min(1).max(65535), localControl: z.string().regex(/^\\\\\.\\pipe\\[^\\]+$/, "local control must be a local named pipe") }),
  roots: z.strictObject({ sourceInstance: absolutePath, roles: rolesSchema }),
  artifacts: artifactsSchema,
  piProfile: z.strictObject({ policy: z.enum(["owning-user-standard", "synthetic-isolated"]), version: z.string().min(1) }),
  runtimes: z.strictObject({
    node: z.strictObject({ version: z.string().min(1), architecture: z.literal("x64"), sha256 }), nodeApi: generation,
    pi: z.strictObject({ version: z.string().min(1), integrity: z.string().min(1) }), addonAbi: z.string().min(1),
    toolchain: z.strictObject({ msvc: z.string().min(1), windowsSdk: z.string().min(1), cmake: z.string().min(1), cpp: z.literal("20") }),
  }),
  compatibility: z.strictObject({
    daemonWorker: z.array(generation).min(1), publicProtocol: z.array(generation).min(1), localControl: z.array(generation).min(1), capability: z.array(generation).min(1), addon: z.array(generation).min(1), schema: z.array(generation).min(1),
    piArtifacts: z.array(z.strictObject({ from: generation, to: generation, converterArtifact: z.literal("maintenance") })),
  }),
  closure: z.strictObject({ id: z.string().min(1), sbom: artifact }),
  execution: z.strictObject({ implementation: z.enum(["real", "deterministic"]), evidenceClass: z.enum(["local-source", "installed-signed", "deterministic-test"]) }),
  provenance: z.record(z.string().min(1), provenanceEntry),
}).superRefine((value, context) => {
  const root = normalized(value.roots.sourceInstance);
  const expectedRootPart = value.identity.trustClass === "source" ? "\\pidex\\source\\" : "\\pidex\\installed\\";
  if (!root.includes(expectedRootPart)) issue(context, ["identity", "trustClass"], "trust class does not match its profile root");

  const rolePaths = Object.values(value.roots.roles).map(normalized);
  for (const [role, path] of Object.entries(value.roots.roles)) {
    if (!isWithin(root, normalized(path))) issue(context, ["roots", "roles", role], "root crossover outside the selected instance");
  }
  if (new Set(rolePaths).size !== rolePaths.length) issue(context, ["roots", "roles"], "root roles must be distinct");
  for (const [role, entry] of Object.entries(value.artifacts)) {
    if (!isWithin(root, normalized(entry.path))) issue(context, ["artifacts", role, "path"], "artifact crossover outside the selected instance");
  }
  if (!isWithin(root, normalized(value.closure.sbom.path))) issue(context, ["closure", "sbom", "path"], "SBOM crossover outside the selected instance");

  if (value.execution.implementation === "real") {
    if (value.piProfile.policy !== "owning-user-standard") issue(context, ["piProfile"], "real execution requires the owning user's standard Pi profile");
    if (value.endpoints.canonicalPort !== 47831) issue(context, ["endpoints", "canonicalPort"], "real execution requires fixed canonical port 47831");
    if (value.execution.evidenceClass === "deterministic-test") issue(context, ["execution"], "real execution cannot claim deterministic evidence");
  } else if (value.identity.trustClass !== "source" || value.execution.evidenceClass !== "deterministic-test") {
    issue(context, ["execution"], "deterministic execution is restricted to isolated source test manifests");
  }
  if (value.identity.trustClass === "source" && value.execution.evidenceClass === "installed-signed") issue(context, ["execution"], "source trust class cannot claim installed evidence");
  if (value.identity.trustClass === "installed" && value.execution.evidenceClass !== "installed-signed") issue(context, ["execution"], "installed trust class requires installed evidence");
  if (value.runtimes.pi.version !== value.piProfile.version) issue(context, ["runtimes", "pi"], "Pi generation/version mismatch");
  const checks: Array<[keyof typeof value.compatibility, number]> = [["daemonWorker", value.generations.worker], ["publicProtocol", value.generations.publicProtocol], ["localControl", value.generations.localControl], ["capability", value.generations.capability], ["addon", value.generations.addon], ["schema", value.generations.schema]];
  for (const [field, current] of checks) if (!(value.compatibility[field] as number[]).includes(current)) issue(context, ["compatibility", field], `generation ${current} is incompatible`);
});

export type ResolvedLaunchManifest = z.infer<typeof resolvedLaunchManifestSchema>;

export function parseResolvedLaunchManifest(input: unknown): ResolvedLaunchManifest {
  return resolvedLaunchManifestSchema.parse(input);
}

/** Stable UTF-8 JSON input for hashing and byte-for-byte transfer between runtime components. */
export function canonicalizeResolvedLaunchManifest(manifest: ResolvedLaunchManifest): string {
  const validated = parseResolvedLaunchManifest(manifest);
  return JSON.stringify(sortValue(validated));
}

function normalized(path: string): string { return win32.normalize(path).toLowerCase().replace(/\\$/, ""); }
function isWithin(root: string, path: string): boolean { return path.startsWith(`${root}\\`); }
function issue(context: z.core.$RefinementCtx, path: PropertyKey[], message: string): void { context.addIssue({ code: "custom", path, message }); }
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortValue(child)]));
  return value;
}
