import { runHost } from "./run-host.js";

process.env.PIDEX_ADAPTERS ??= "deterministic";
process.env.PIDEX_DATA_DIR ??= ".pidex-data-dev";

const adapterMode =
  process.env.PIDEX_ADAPTERS === "deterministic" ? "deterministic" : "product";

await runHost(adapterMode);
