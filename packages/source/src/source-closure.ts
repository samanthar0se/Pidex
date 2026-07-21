import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { publishValidatedTree } from "../../durability/src/index.js";

const requiredRoles = [
  "runtime",
  "emitted-code",
  "dependencies",
  "pi",
  "companion",
  "addon",
  "launcher",
  "schemas",
  "tools",
  "lockfile",
] as const;

export type SourceClosureRole = (typeof requiredRoles)[number];

export interface SourceClosureFile {
  role: SourceClosureRole;
  /** Portable relative path chosen by the resolved source build plan. */
  path: string;
  /** Captured exact bytes; publication never reads mutable compiler output. */
  bytes: Uint8Array;
}

export interface SourceClosureIdentity {
  schemaVersion: 1;
  trustClass: "local-source";
  /** Prebuilt selection is explicit and mutually exclusive with source build. */
  inputMode: "source-build" | "hash-verified-prebuilt";
  node: { version: string; architecture: "x64" };
  nodeApi: number;
  pi: { version: "0.80.10"; integrity: string };
  toolchain: {
    msvc: string;
    windowsSdk: string;
    cmake: string;
    cpp: "20";
  };
  sourceIdentity: string;
}

export interface SourceClosurePlan extends SourceClosureIdentity {
  files: readonly SourceClosureFile[];
}

interface ClosureFileRecord {
  role: SourceClosureRole;
  path: string;
  size: number;
  sha256: string;
}

type ClosureManifest = ReturnType<typeof createClosureManifest>;

export interface PublishedSourceClosure {
  releaseId: string;
  directory: string;
  outcome: "published" | "already-published";
}

export interface SourceClosureEvidence {
  releaseId: string;
  closureSha256: string;
  roles: SourceClosureRole[];
}

export function publishImmutableSourceClosure(options: {
  releasesDirectory: string;
  plan: SourceClosurePlan;
}): PublishedSourceClosure {
  const material = resolvePlan(options.plan);
  const target = join(options.releasesDirectory, material.manifest.releaseId);
  const publication = publishValidatedTree({
    target,
    materialize(stage) {
      for (const file of material.files) {
        const path = safePath(stage, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.bytes, { flag: "wx" });
      }
      writeFileSync(join(stage, "sbom.cdx.json"), material.sbom, { flag: "wx" });
      writeFileSync(join(stage, "closure.json"), canonicalJson(material.manifest), {
        flag: "wx",
      });
    },
    validate(candidate) {
      verifySourceClosure(candidate, false);
    },
  });
  makeReadOnly(publication.target);
  return {
    releaseId: material.manifest.releaseId,
    directory: publication.target,
    outcome: publication.outcome,
  };
}

export function verifyPublishedSourceClosure(directory: string): SourceClosureEvidence {
  return verifySourceClosure(directory, true);
}

function verifySourceClosure(directory: string, requireContentAddressedLocation: boolean): SourceClosureEvidence {
  const manifest = parseManifest(readFileSync(join(directory, "closure.json"), "utf8"));
  assertRequiredRoles(manifest.files);
  const expectedPaths = new Set(["closure.json", manifest.sbom.path]);
  for (const file of manifest.files) {
    if (expectedPaths.has(file.path)) throw new Error(`duplicate closure path: ${file.path}`);
    expectedPaths.add(file.path);
    const bytes = readFileSync(safePath(directory, file.path));
    if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) {
      throw new Error(`closure file hash mismatch: ${file.path}`);
    }
  }
  const sbom = readFileSync(safePath(directory, manifest.sbom.path));
  if (sha256(sbom) !== manifest.sbom.sha256) throw new Error("closure SBOM hash mismatch");
  const actualPaths = listFiles(directory);
  if (actualPaths.length !== expectedPaths.size || actualPaths.some(path => !expectedPaths.has(path))) {
    throw new Error("closure contains undeclared content");
  }
  const expectedReleaseId = releaseIdFor({ ...manifest, releaseId: undefined });
  if (manifest.releaseId !== expectedReleaseId || (requireContentAddressedLocation && resolve(directory) !== resolve(dirname(directory), expectedReleaseId))) {
    throw new Error("closure content identity mismatch");
  }
  return {
    releaseId: manifest.releaseId,
    closureSha256: manifest.releaseId.slice("sha256-".length),
    roles: [...new Set(manifest.files.map(file => file.role))].sort(),
  };
}

function resolvePlan(plan: SourceClosurePlan) {
  if (plan.schemaVersion !== 1 || plan.trustClass !== "local-source") throw new Error("invalid source closure plan");
  if (plan.pi.version !== "0.80.10") throw new Error("Pi version must be exactly 0.80.10");
  const paths = new Set<string>();
  const files = plan.files.map(file => {
    const path = safeRelativePath(file.path);
    if (paths.has(path) || path === "closure.json" || path === "sbom.cdx.json") throw new Error(`duplicate closure path: ${path}`);
    paths.add(path);
    const bytes = Buffer.from(file.bytes);
    return { ...file, path, bytes, size: bytes.byteLength, sha256: sha256(bytes) };
  });
  assertRequiredRoles(files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const records = files.map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }));
  const sbom = Buffer.from(canonicalJson({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    components: records.map(file => ({ type: "file", name: file.path, group: file.role, hashes: [{ alg: "SHA-256", content: file.sha256 }] })),
  }));
  const manifest = createClosureManifest(plan, records, {
    path: "sbom.cdx.json",
    sha256: sha256(sbom),
  });
  return { files, sbom, manifest };
}

function parseManifest(text: string): ClosureManifest {
  const value = JSON.parse(text) as ClosureManifest;
  const keys = value && typeof value === "object"
    ? Object.keys(createClosureManifest(value, value.files, value.sbom))
    : [];
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== keys.sort().join() || value.schemaVersion !== 1 || value.trustClass !== "local-source" || !Array.isArray(value.files)) {
    throw new Error("invalid source closure manifest");
  }
  return value;
}

function createClosureManifest(
  source: SourceClosureIdentity,
  files: ClosureFileRecord[],
  sbom: { path: "sbom.cdx.json"; sha256: string },
) {
  const identity = {
    ...selectSourceClosureIdentity(source),
    files,
    sbom,
  };
  return { ...identity, releaseId: releaseIdFor(identity) };
}

function selectSourceClosureIdentity(source: SourceClosureIdentity): SourceClosureIdentity {
  return {
    schemaVersion: source.schemaVersion,
    trustClass: source.trustClass,
    inputMode: source.inputMode,
    node: source.node,
    nodeApi: source.nodeApi,
    pi: source.pi,
    toolchain: source.toolchain,
    sourceIdentity: source.sourceIdentity,
  };
}

function assertRequiredRoles(files: readonly { role: SourceClosureRole }[]): void {
  const roles = new Set(files.map(file => file.role));
  for (const role of requiredRoles) if (!roles.has(role)) throw new Error(`missing required closure role: ${role}`);
  for (const role of roles) if (!(requiredRoles as readonly string[]).includes(role)) throw new Error(`unknown closure role: ${role}`);
}

function safeRelativePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  if (!path || normalized === "." || normalized.startsWith("../") || posix.isAbsolute(normalized)) throw new Error(`closure path must be relative: ${path}`);
  return normalized;
}

function safePath(root: string, path: string): string {
  const target = resolve(root, ...safeRelativePath(path).split("/"));
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw new Error("closure path escapes release root");
  return target;
}

function listFiles(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error("closure contains non-regular content");
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path).split(sep).join("/")];
  }).sort();
}

function makeReadOnly(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) makeReadOnly(path);
    else chmodSync(path, 0o444);
  }
  chmodSync(directory, 0o555);
}

function releaseIdFor(value: unknown): string { return `sha256-${sha256(Buffer.from(canonicalJson(value)))}`; }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function canonicalJson(value: unknown): string { return JSON.stringify(sortKeys(value)); }
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortKeys(child)]));
  return value;
}
