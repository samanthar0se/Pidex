import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Static Host assets are intentionally resolved from the unpacked artifact.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url))));
process.env.PIDEX_DATA_DIR ??= resolve("data");
process.env.PIDEX_CLIENT_DIST = resolve("client");

const { runHost } = await import("./run-host.js");
await runHost("deterministic", 47831);
