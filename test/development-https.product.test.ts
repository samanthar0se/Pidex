import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptersFor } from "../packages/adapters/src/index.js";
import {
  provisionDevelopmentCertificate,
  setupDevelopmentCa,
} from "../packages/host/src/development-ca.js";
import { startHost } from "../packages/host/src/host.js";

test("checkouts reuse one CA and replace only invalid disposable typed-SAN leaves", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-https-"));
  const profileRoot = join(root, "profile");
  const checkoutA = join(root, "checkout-a");
  const checkoutB = join(root, "checkout-b");
  try {
    const setup = setupDevelopmentCa({ profileRoot, trustCurrentUserCertificate() {} });
    const first = provisionDevelopmentCertificate({
      profileRoot, dataDir: checkoutA, hostname: "DEV.example", aliases: ["10.2.3.4", "2001:db8::1", "dev.example"],
    });
    const restarted = provisionDevelopmentCertificate({
      profileRoot, dataDir: checkoutA, hostname: "dev.example", aliases: ["2001:db8::1", "10.2.3.4"],
    });
    const other = provisionDevelopmentCertificate({ profileRoot, dataDir: checkoutB, hostname: "other.example" });

    assert.deepEqual(restarted.cert, first.cert);
    assert.notDeepEqual(other.cert, first.cert);
    for (const leaf of [first, other]) {
      assert.equal(new X509Certificate(leaf.ca).fingerprint256, setup.fingerprint);
      const certificate = new X509Certificate(leaf.cert);
      assert.equal(certificate.checkIssued(new X509Certificate(leaf.ca)), true);
      assert.match(certificate.subjectAltName!, /DNS:dev\.example|DNS:other\.example/);
      assert.match(certificate.subjectAltName!, /IP Address:127\.0\.0\.1/);
      assert.match(certificate.subjectAltName!, /IP Address:0:0:0:0:0:0:0:1|IP Address:::1/);
    }
    assert.deepEqual((await readdir(join(checkoutA, "development-tls"))).sort(), ["leaf-key.pem", "leaf.pem"]);

    await writeFile(join(checkoutA, "development-tls", "leaf-key.pem"), "mismatched key");
    const replaced = provisionDevelopmentCertificate({ profileRoot, dataDir: checkoutA, hostname: "dev.example", aliases: ["10.2.3.4", "2001:db8::1"] });
    assert.notDeepEqual(replaced.cert, first.cert);
    assert.deepEqual(replaced.ca, first.ca);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("development startup serves real HTTPS only after profile setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-development-startup-"));
  const profileRoot = join(root, "profile");
  const provisioner = ({ dataDir, hostname }: { dataDir: string; hostname: string }) =>
    provisionDevelopmentCertificate({ profileRoot, dataDir, hostname });
  try {
    await assert.rejects(
      startHost({ dataDir: join(root, "missing"), port: 0, adapters: adaptersFor("deterministic"), certificateProvisioner: provisioner }),
      /Development CA unusable.*dev:ca:reset.*dev:ca:setup/,
    );
    setupDevelopmentCa({ profileRoot, trustCurrentUserCertificate() {} });
    const host = await startHost({ dataDir: join(root, "configured"), port: 0, adapters: adaptersFor("deterministic"), certificateProvisioner: provisioner });
    try {
      const ca = await readFile(join(profileRoot, "Pidex", "Development CA", "pidex-development-ca.pem"));
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const call = request(host.origin, { ca }, response => {
          resolve(response.statusCode);
          response.resume();
        });
        call.on("error", reject);
        call.end();
      });
      assert.equal(status, 200);
    } finally { await host.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
