import { join, resolve } from "node:path";
import {
  adaptersFor,
  type AdapterMode,
} from "../../adapters/src/index.js";
import type { HostCertificateProvisioner } from "./certificate.js";
import { developmentCaDirectory } from "./development-ca.js";
import { startHost } from "./host.js";

export async function runHost(
  adapterMode: AdapterMode,
  certificateProvisioner?: HostCertificateProvisioner,
): Promise<void> {
  const dataDir = resolve(process.env.PIDEX_DATA_DIR ?? ".pidex-data");
  const port = Number(process.env.PIDEX_PORT ?? 7443);
  const hostname =
    adapterMode === "deterministic" ? process.env.PIDEX_HOSTNAME : undefined;
  const host = await startHost({
    dataDir,
    port,
    hostname,
    adapters: adaptersFor(adapterMode),
    certificateProvisioner,
  });

  console.log(`Pidex ready at ${host.origin} (${host.status().hostId})`);
  if (adapterMode === "deterministic") {
    console.log(`Pair this device: ${host.createPairing().qrPayload}`);
    printCertificateTrustGuidance();
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await host.close();
      process.exit(0);
    });
  }
}

function printCertificateTrustGuidance(): void {
  const certificatePath = join(
    developmentCaDirectory(process.env.PIDEX_DEVELOPMENT_PROFILE_ROOT),
    "pidex-development-ca.pem",
  );
  if (process.platform === "win32") {
    console.log(
      `If HTTPS is not trusted, run: certutil -user -addstore Root "${certificatePath}"`,
    );
    return;
  }

  console.log(
    `If HTTPS is not trusted, trust the development CA: ${certificatePath}`,
  );
}
