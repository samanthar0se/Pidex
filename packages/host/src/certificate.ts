import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

export interface HostCertificate {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
}

export interface HostCertificateProvisioningRequest {
  dataDir: string;
  hostname: string;
  windows: WindowsPlatformAdapter;
}

/** A startup boundary; development certificate state can live outside Host authority. */
export type HostCertificateProvisioner = (
  request: HostCertificateProvisioningRequest,
) => HostCertificate | Promise<HostCertificate>;

/** The packaged Host identity remains the default and retains its protected keys/trust. */
export const provisionPackagedHostCertificate: HostCertificateProvisioner =
  request =>
    ensureCertificate(request.dataDir, request.hostname, request.windows);

export function ensureCertificate(
  dataDir: string,
  hostname: string,
  windows: WindowsPlatformAdapter,
): HostCertificate {
  const directory = join(dataDir, "tls");
  const paths: CertificatePaths = {
    caCertificatePath: join(directory, "pidex-ca.pem"),
    protectedCaKeyPath: join(directory, "pidex-ca-key.dpapi"),
    hostCertificatePath: join(directory, "host.pem"),
    protectedHostKeyPath: join(directory, "host-key.dpapi"),
  };
  mkdirSync(directory, { recursive: true });

  const certificateExists = Object.values(paths).every(path => existsSync(path));

  if (!certificateExists) {
    windows.restrictToCurrentUser(directory);
    generateCertificate(directory, hostname, windows, paths);
    windows.trustCurrentUserCertificate(paths.caCertificatePath);
  }

  return {
    key: windows.unprotectForCurrentUser(
      readFileSync(paths.protectedHostKeyPath),
    ),
    cert: readFileSync(paths.hostCertificatePath),
    ca: readFileSync(paths.caCertificatePath),
  };
}

interface CertificatePaths {
  caCertificatePath: string;
  protectedCaKeyPath: string;
  hostCertificatePath: string;
  protectedHostKeyPath: string;
}

function generateCertificate(
  directory: string,
  hostname: string,
  windows: WindowsPlatformAdapter,
  paths: CertificatePaths,
): void {
  const caPrivateKeyPath = join(directory, ".ca-key.pem");
  const hostPrivateKeyPath = join(directory, ".leaf-key.pem");
  const certificateRequestPath = join(directory, ".leaf.csr");
  const extensionsPath = join(directory, ".leaf.ext");
  const serialPath = join(directory, "pidex-ca.srl");
  const temporaryPaths = [
    caPrivateKeyPath,
    hostPrivateKeyPath,
    certificateRequestPath,
    extensionsPath,
    serialPath,
  ];

  try {
    runOpenSsl([
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", caPrivateKeyPath,
      "-out", paths.caCertificatePath,
      "-days", "3650",
      "-subj", "/CN=Pidex Private CA",
    ]);
    runOpenSsl([
      "req", "-newkey", "rsa:2048", "-nodes",
      "-keyout", hostPrivateKeyPath,
      "-out", certificateRequestPath,
      "-subj", `/CN=${hostname}`,
    ]);
    writeFileSync(
      extensionsPath,
      `subjectAltName=DNS:${hostname},DNS:localhost,IP:127.0.0.1\n`,
    );
    runOpenSsl([
      "x509", "-req",
      "-in", certificateRequestPath,
      "-CA", paths.caCertificatePath,
      "-CAkey", caPrivateKeyPath,
      "-CAcreateserial",
      "-out", paths.hostCertificatePath,
      "-days", "825",
      "-extfile", extensionsPath,
    ]);
    writeFileSync(
      paths.protectedCaKeyPath,
      windows.protectForCurrentUser(readFileSync(caPrivateKeyPath)),
    );
    writeFileSync(
      paths.protectedHostKeyPath,
      windows.protectForCurrentUser(readFileSync(hostPrivateKeyPath)),
    );
  } finally {
    for (const path of temporaryPaths) {
      rmSync(path, { force: true });
    }
  }
}

function runOpenSsl(opensslArguments: string[]): void {
  execFileSync("openssl", opensslArguments, { stdio: "ignore" });
}
