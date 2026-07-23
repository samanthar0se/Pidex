import { runHost } from "./run-host.js";

process.env.PIDEX_DATA_DIR ??= ".pidex-data-dev";

await runHost("pi");
