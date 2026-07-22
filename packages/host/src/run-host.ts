import { resolve } from "node:path";
import {
  adaptersFor,
  type AdapterMode,
} from "../../adapters/src/index.js";
import { startHost } from "./host.js";

export async function runHost(adapterMode: AdapterMode): Promise<void> {
  const dataDir = resolve(process.env.PIDEX_DATA_DIR ?? ".pidex-data");
  const port = Number(process.env.PIDEX_PORT ?? 7443);
  const host = await startHost({
    dataDir,
    port,
    adapters: adaptersFor(adapterMode),
  });

  console.log("UNAUTHENTICATED PROTOTYPE: anyone who can reach this Host on the network can view and control Pidex. Do not expose it beyond a trusted LAN.");
  console.log(`Pidex ready on 0.0.0.0:${port}`);
  console.log(`Loopback: http://localhost:${port}`);
  console.log(`LAN: http://<LAN-IP>:${port}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await host.close();
      process.exit(0);
    });
  }
}
