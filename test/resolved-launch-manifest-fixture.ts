import { PINNED_PI_VERSION } from "../packages/pi-version/src/index.js";

const ROOT_ROLES = [
  "instanceIdentity",
  "controlCredential",
  "authorityGenerations",
  "generationSelectors",
  "immutableBlobs",
  "checkpointChunks",
  "checkpointManifests",
  "workerState",
  "migrationStaging",
  "recoverySnapshots",
  "managedBackups",
  "diagnostics",
  "launcherState",
  "publicationTemp",
] as const;

const ARTIFACT_ROLES = [
  "launcher",
  "node",
  "daemon",
  "worker",
  "addon",
  "companion",
  "schemas",
  "maintenance",
] as const;

type ArtifactRole = (typeof ARTIFACT_ROLES)[number];

export function createPiManifestFixture(
  policy: "owning-user-standard" | "synthetic-isolated",
) {
  return {
    profile: { policy, version: PINNED_PI_VERSION },
    runtime: { version: PINNED_PI_VERSION, integrity: "sha512-test" },
  };
}

export function createLaunchManifestRoleRoots(root: string) {
  return Object.fromEntries(
    ROOT_ROLES.map(role => [role, `${root}\\${role}`]),
  );
}

export function createLaunchManifestArtifacts(
  root: string,
  sha256ForRole: (role: ArtifactRole) => string,
) {
  return Object.fromEntries(
    ARTIFACT_ROLES.map((role, index) => [
      role,
      {
        path: `${root}\\releases\\r1\\${index}.bin`,
        sha256: sha256ForRole(role),
      },
    ]),
  );
}
