import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

export interface HostCertificate {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
}

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

  const certificateMaterialExists = Object.values(paths).every(path =>
    existsSync(path),
  );
  const certificateNeedsRegeneration =
    !certificateMaterialExists ||
    !certificateCoversHostname(paths.hostCertificatePath, hostname);

  if (certificateNeedsRegeneration) {
    windows.restrictToCurrentUser(directory);
    generateCertificate(
      directory,
      hostname,
      windows,
      paths,
      certificateMaterialExists,
    );
    if (!certificateMaterialExists) {
      windows.trustCurrentUserCertificate(paths.caCertificatePath);
    }
  }

  return {
    key: windows.unprotectForCurrentUser(
      readFileSync(paths.protectedHostKeyPath),
    ),
    cert: readFileSync(paths.hostCertificatePath),
    ca: readFileSync(paths.caCertificatePath),
  };
}

function certificateCoversHostname(
  certificatePath: string,
  hostname: string,
): boolean {
  try {
    const certificate = new X509Certificate(readFileSync(certificatePath));
    return isIP(hostname)
      ? certificate.checkIP(hostname) !== undefined
      : certificate.checkHost(hostname) !== undefined;
  } catch {
    return false;
  }
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
  reuseCertificateAuthority: boolean,
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
    if (reuseCertificateAuthority) {
      writeFileSync(
        caPrivateKeyPath,
        windows.unprotectForCurrentUser(
          readFileSync(paths.protectedCaKeyPath),
        ),
      );
    } else {
      runOpenSsl([
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", caPrivateKeyPath,
        "-out", paths.caCertificatePath,
        "-days", "3650",
        "-subj", "/CN=Pidex Private CA",
      ]);
    }
    runOpenSsl([
      "req", "-newkey", "rsa:2048", "-nodes",
      "-keyout", hostPrivateKeyPath,
      "-out", certificateRequestPath,
      "-subj", `/CN=${hostname}`,
    ]);
    const subjectAlternativeNameType = isIP(hostname) ? "IP" : "DNS";
    writeFileSync(
      extensionsPath,
      `subjectAltName=${subjectAlternativeNameType}:${hostname},DNS:localhost,IP:127.0.0.1\n`,
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
    if (!reuseCertificateAuthority) {
      writeFileSync(
        paths.protectedCaKeyPath,
        windows.protectForCurrentUser(readFileSync(caPrivateKeyPath)),
      );
    }
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
