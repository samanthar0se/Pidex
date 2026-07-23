import { runHost } from "./run-host.js";

process.env.PIDEX_DATA_DIR ??= ".pidex-data-dev";
process.env.PIDEX_PROJECT_PATH ??= process.cwd();

await runHost("deterministic");
