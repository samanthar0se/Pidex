import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import type { WindowsPlatformAdapter } from "../../adapters/src/index.js";

export const DEVELOPMENT_CA_REMEDIATION =
  "Development CA unusable. Startup did not replace it; run `npm run dev-ca:reset`, then `npm run dev-ca:setup`.";

export interface DevelopmentCaResult {
  status: "created" | "unchanged";
  fingerprint: string;
  certificatePath: string;
}

export interface DevelopmentCertificate {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
  fingerprint: string;
  replaced: boolean;
}

type TrustAdapter = Pick<WindowsPlatformAdapter, "trustCurrentUserCertificate"> & {
  removeCurrentUserCertificate?(certificatePath: string): void;
};

const names = { certificate: "development-ca.pem", key: "development-ca-key.pem" };

export function defaultDevelopmentCaDirectory(environment = process.env): string {
  const localAppData = environment.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA is required for the Windows Development CA profile location");
  return join(localAppData, "Pidex", "development-ca");
}

export function setupDevelopmentCa(profileDir: string, windows: TrustAdapter): DevelopmentCaResult {
  mkdirSync(profileDir, { recursive: true });
  const paths = caPaths(profileDir);
  const present = [paths.certificate, paths.key].map(existsSync);
  let status: DevelopmentCaResult["status"] = "unchanged";
  if (!present[0] && !present[1]) {
    requireOpenSsl();
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3650",
      "-keyout", paths.key, "-out", paths.certificate, "-subj", "/CN=Pidex Development CA",
      "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
    status = "created";
  } else if (!present.every(Boolean)) {
    throw unusable();
  }
  const ca = validateCa(paths);
  windows.trustCurrentUserCertificate(paths.certificate);
  return { status, fingerprint: fingerprint(ca), certificatePath: paths.certificate };
}

export function ensureDevelopmentCertificate(
  profileDir: string,
  checkoutDataDir: string,
  requestedNames: readonly string[],
  now = new Date(),
): DevelopmentCertificate {
  const paths = caPaths(profileDir);
  let ca: X509Certificate;
  try { ca = validateCa(paths, now); } catch { throw unusable(); }
  const tlsDir = join(checkoutDataDir, "tls");
  mkdirSync(tlsDir, { recursive: true });
  const leafCert = join(tlsDir, "development-leaf.pem");
  const leafKey = join(tlsDir, "development-leaf-key.pem");
  const sans = normalizedSans(requestedNames);
  if (leafReusable(leafCert, leafKey, ca, sans, now)) {
    return result(false);
  }
  requireOpenSsl();
  const csr = join(tlsDir, ".leaf.csr");
  const ext = join(tlsDir, ".leaf.ext");
  const serial = join(tlsDir, ".ca.srl");
  try {
    run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", leafKey, "-out", csr,
      "-subj", `/CN=${sans[0]!.value}`]);
    writeFileSync(ext, [
      "basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth", `subjectAltName=${sans.map(s => `${s.type}:${s.value}`).join(",")}`,
    ].join("\n"));
    run(["x509", "-req", "-in", csr, "-CA", paths.certificate, "-CAkey", paths.key,
      "-CAcreateserial", "-CAserial", serial, "-out", leafCert, "-days", "825", "-sha256", "-extfile", ext]);
  } finally { for (const path of [csr, ext, serial]) rmSync(path, { force: true }); }
  const issuanceValidationTime = new Date(Math.max(now.getTime(), Date.now()));
  if (!leafReusable(leafCert, leafKey, ca, sans, issuanceValidationTime, 0)) throw new Error("Generated Development leaf failed validation");
  return result(true);

  function result(replaced: boolean): DevelopmentCertificate {
    return { key: readFileSync(leafKey), cert: readFileSync(leafCert), ca: ca.raw,
      fingerprint: fingerprint(ca), replaced };
  }
}

export function resetDevelopmentCa(profileDir: string, windows: TrustAdapter): { warning: string; cleanup: "complete" | "best-effort" } {
  const paths = caPaths(profileDir);
  let cleanup: "complete" | "best-effort" = "complete";
  if (existsSync(paths.certificate)) {
    try { windows.removeCurrentUserCertificate?.(paths.certificate); }
    catch { cleanup = "best-effort"; }
  }
  rmSync(paths.certificate, { force: true });
  rmSync(paths.key, { force: true });
  return { warning: "Development CA reset affects every checkout and previously trusted LAN client. Run setup next; distribute only the public certificate.", cleanup };
}

function caPaths(dir: string) { return { certificate: join(dir, names.certificate), key: join(dir, names.key) }; }
function validateCa(paths: ReturnType<typeof caPaths>, now = new Date()): X509Certificate {
  if (!existsSync(paths.certificate) || !existsSync(paths.key)) throw unusable();
  const cert = new X509Certificate(readFileSync(paths.certificate));
  const keyBytes = readFileSync(paths.key);
  createPrivateKey(keyBytes);
  if (!cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey) ||
      createPublicKey(keyBytes).export({ type: "spki", format: "der" }).compare(cert.publicKey.export({ type: "spki", format: "der" })) !== 0 ||
      now < new Date(cert.validFrom) || now >= new Date(cert.validTo)) throw unusable();
  const text = run(["x509", "-in", paths.certificate, "-noout", "-text"], true);
  if (!/Basic Constraints: critical[\s\S]*CA:TRUE, pathlen:0/.test(text) ||
      !/Key Usage: critical[\s\S]*Certificate Sign/.test(text)) throw unusable();
  return cert;
}
type San = { type: "DNS" | "IP"; value: string };
function normalizedSans(values: readonly string[]): San[] {
  const all = [...values, "localhost", "127.0.0.1"];
  const map = new Map<string, San>();
  for (const value of all) { const san: San = { type: isIP(value) ? "IP" : "DNS", value }; map.set(`${san.type}:${value.toLowerCase()}`, san); }
  return [...map.values()].sort((a, b) => `${a.type}:${a.value}`.localeCompare(`${b.type}:${b.value}`));
}
function leafReusable(certPath: string, keyPath: string, ca: X509Certificate, sans: San[], now: Date, marginDays = 30): boolean {
  try {
    if (!existsSync(certPath) || !existsSync(keyPath)) return false;
    const cert = new X509Certificate(readFileSync(certPath));
    const keyBytes = readFileSync(keyPath);
    createPrivateKey(keyBytes);
    const actual = (cert.subjectAltName?.split(", ") ?? []).map(v => v.replace("IP Address:", "IP:")).sort();
    const expected = sans.map(s => `${s.type}:${s.value}`).sort();
    return !cert.ca && cert.checkIssued(ca) && cert.verify(ca.publicKey) &&
      createPublicKey(keyBytes).export({ type: "spki", format: "der" }).compare(cert.publicKey.export({ type: "spki", format: "der" })) === 0 &&
      now >= new Date(cert.validFrom) && now.getTime() + marginDays * 86400000 < new Date(cert.validTo).getTime() &&
      JSON.stringify(actual) === JSON.stringify(expected) &&
      (cert.keyUsage === undefined || cert.keyUsage.includes("1.3.6.1.5.5.7.3.1"));
  } catch { return false; }
}
function fingerprint(cert: X509Certificate): string { return createHash("sha256").update(cert.raw).digest("hex").toUpperCase().match(/../g)!.join(":"); }
function requireOpenSsl(): void { try { run(["version"], true); } catch { throw new Error("OpenSSL is required for Development CA setup and leaf issuance"); } }
function run(args: string[], output = false): string { return execFileSync("openssl", args, { encoding: "utf8", stdio: output ? "pipe" : "ignore" }) ?? ""; }
function unusable(): Error { return new Error(DEVELOPMENT_CA_REMEDIATION); }
