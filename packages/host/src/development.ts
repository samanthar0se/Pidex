import { runHost } from "./run-host.js";
import { provisionDevelopmentCertificate } from "./development-ca.js";

process.env.PIDEX_DATA_DIR ??= ".pidex-data-dev";

await runHost("deterministic", request =>
  provisionDevelopmentCertificate({
    dataDir: request.dataDir,
    hostname: request.hostname,
    profileRoot: process.env.PIDEX_DEVELOPMENT_PROFILE_ROOT,
  }),
);
