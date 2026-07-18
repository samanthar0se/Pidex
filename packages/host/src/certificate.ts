import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function ensureCertificate(dataDir: string) {
  const certificateDirectory = join(dataDir, "tls");
  const key = join(certificateDirectory, "localhost-key.pem");
  const cert = join(certificateDirectory, "localhost-cert.pem");

  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(certificateDirectory, { recursive: true });
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "3650",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
  }

  return { key, cert };
}
