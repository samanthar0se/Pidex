import { resolve } from "node:path";
import {
  adaptersFor,
} from "../../adapters/src/index.js";
import { RealPiAdapter } from "../../pi-worker/src/index.js";
import { startHost } from "./host.js";

export type HostRuntime = "deterministic" | "pi";

export async function runHost(runtime: HostRuntime, defaultPort = 7443): Promise<void> {
  if (runtime !== "deterministic" && runtime !== "pi") {
    throw new Error(`unknown Host runtime: ${runtime}`);
  }
  const dataDir = resolve(process.env.PIDEX_DATA_DIR ?? ".pidex-data");
  const port = Number(process.env.PIDEX_PORT ?? defaultPort);
  const adapters = adaptersFor("deterministic");
  if (runtime === "pi") {
    adapters.pi = new RealPiAdapter({
      cwd: resolve(process.env.PIDEX_WORKSPACE ?? process.cwd()),
      sessionsDirectory: resolve(dataDir, "pi-sessions"),
    });
  }
  const host = await startHost({
    dataDir,
    port,
    adapters,
  });

  console.log("UNAUTHENTICATED PROTOTYPE: anyone who can reach this Host on the network can view and control Pidex. Do not expose it beyond a trusted LAN.");
  console.log(`Pidex ready with ${runtime === "pi" ? "Pi SDK" : "deterministic test runtime"} on 0.0.0.0:${port}`);
  console.log(`Loopback: http://localhost:${port}`);
  console.log(`LAN: http://<LAN-IP>:${port}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await host.close();
      process.exit(0);
    });
  }
}
