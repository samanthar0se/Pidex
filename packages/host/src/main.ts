import { resolve } from "node:path";
import { adaptersFor } from "../../adapters/src/index.js";
import { startHost } from "./host.js";

const dataDir = resolve(process.env.PIDEX_DATA_DIR ?? ".pidex-data");
const mode =
  process.env.PIDEX_ADAPTERS === "deterministic" ? "deterministic" : "product";
const port = Number(process.env.PIDEX_PORT ?? 7443);
const hostname =
  mode === "deterministic" ? process.env.PIDEX_HOSTNAME : undefined;
const host = await startHost({
  dataDir,
  port,
  hostname,
  adapters: adaptersFor(mode),
});

console.log(`Pidex ready at ${host.origin} (${host.status().hostId})`);
if (mode === "deterministic") {
  console.log(`Pair this device: ${host.createPairing().qrPayload}`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await host.close();
    process.exit(0);
  });
}
