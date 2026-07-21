/**
 * Product startup is intentionally exported rather than ambiently configured.
 * The native launcher supplies the verified manifest and concrete owner
 * factories; direct execution cannot fall back to product adapters, ports, or
 * profile-relative mutable state.
 */
export {
  composeManifestHost as startManifestDaemon,
  type ManifestHostFactories,
  type ManifestHost,
} from "./daemon-composition.js";
