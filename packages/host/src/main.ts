import { resolve } from "node:path";
import { startHost } from "./host.js";
import { adaptersFor } from "../../adapters/src/index.js";

const dataDir = resolve(process.env.PIDEX_DATA_DIR ?? ".pidex-data");
const mode = process.env.PIDEX_ADAPTERS === "deterministic" ? "deterministic" : "product";
const host = await startHost({ dataDir, port: Number(process.env.PIDEX_PORT ?? 7443), adapters: adaptersFor(mode) });
console.log(`Pidex ready at ${host.origin} (${host.status().hostId})`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => { await host.close(); process.exit(0); });
