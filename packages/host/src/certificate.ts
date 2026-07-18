import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

export function ensureCertificate(dataDir: string, hostname: string, windows: WindowsPlatformAdapter) {
  const directory = join(dataDir, "tls");
  const ca = join(directory, "pidex-ca.pem");
  const caKey = join(directory, "pidex-ca-key.dpapi");
  const leaf = join(directory, "host.pem");
  const leafKey = join(directory, "host-key.dpapi");
  mkdirSync(directory, { recursive: true });

  if (!existsSync(caKey) || !existsSync(leafKey) || !existsSync(ca) || !existsSync(leaf)) {
    const rawCaKey = join(directory, ".ca-key.pem");
    const rawLeafKey = join(directory, ".leaf-key.pem");
    const request = join(directory, ".leaf.csr");
    const extensions = join(directory, ".leaf.ext");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", rawCaKey, "-out", ca, "-days", "3650", "-subj", "/CN=Pidex Private CA"], { stdio: "ignore" });
    execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", rawLeafKey, "-out", request, "-subj", `/CN=${hostname}`], { stdio: "ignore" });
    writeFileSync(extensions, `subjectAltName=DNS:${hostname},DNS:localhost,IP:127.0.0.1\n`);
    execFileSync("openssl", ["x509", "-req", "-in", request, "-CA", ca, "-CAkey", rawCaKey, "-CAcreateserial", "-out", leaf, "-days", "825", "-extfile", extensions], { stdio: "ignore" });
    writeFileSync(caKey, windows.protectForCurrentUser(readFileSync(rawCaKey)));
    writeFileSync(leafKey, windows.protectForCurrentUser(readFileSync(rawLeafKey)));
    for (const path of [rawCaKey, rawLeafKey, request, extensions, `${ca}.srl`]) rmSync(path, { force: true });
    windows.restrictToCurrentUser(directory);
    windows.trustCurrentUserCertificate(ca);
  }

  return { key: windows.unprotectForCurrentUser(readFileSync(leafKey)), cert: readFileSync(leaf) };
}
