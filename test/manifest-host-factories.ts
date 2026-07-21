import {
  type CompositionOwner,
  type ManifestHostFactories,
} from "../packages/host/src/daemon-composition.js";

function inertOwner(): CompositionOwner {
  return { close: async () => {} };
}

export function createCompleteManifestHostFactories(
  overrides: Partial<ManifestHostFactories> = {},
): ManifestHostFactories {
  return {
    proveLauncherContainment: async () => {},
    openAuthenticatedLocalControl: async () => inertOwner(),
    verifyReleaseAndNativeIdentity: async () => {},
    openAuthority: async () => ({ mode: "normal", ...inertOwner() }),
    openDurabilityServices: async () => inertOwner(),
    openWindowsAddonPorts: async () => inertOwner(),
    openModuleRegistry: async () => inertOwner(),
    openLifecycleCoordinator: async () => inertOwner(),
    openBackupRecoveryCoordinator: async () => inertOwner(),
    probePi: async () => {},
    openPiChildSupervisor: async () => inertOwner(),
    openLanEdge: async () => inertOwner(),
    openRunAdmission: async () => inertOwner(),
    ...overrides,
  };
}
