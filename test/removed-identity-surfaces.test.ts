import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

const REMOVED_PRODUCT_PATHS = [
  "apps/pwa",
  "packages/host/src/pairing.ts",
  "packages/host/src/advisory-push.ts",
  "packages/host/src/certificate.ts",
  "packages/host/src/development-ca.ts",
  "packages/host/src/development-ca-setup.ts",
  "packages/host/src/development-ca-reset.ts",
  "packages/host/src/exact-integration-control.ts",
  "packages/host/src/onboarding.ts",
  "packages/windows/src/network.ts",
  "native/windows/common/include/pidex/windows/dns_sd.hpp",
  "native/windows/common/include/pidex/windows/private_network.hpp",
  "native/windows/common/src/dns_sd.cpp",
  "native/windows/common/src/private_network.cpp",
  "scripts/check-development-prerequisites.mjs",
];

const REMOVED_SURFACES = [
  {
    name: "pairing and Device authority contracts",
    pattern:
      /\b(?:PairingAuthority|pairingId|authenticationId|revokeDevice|revoked_devices|devicePublicKey)\b/i,
  },
  {
    name: "Device-keyed advisory push",
    pattern: /\b(?:advisory[ -]?push|pushManager|push-reconcile)\b/i,
  },
  {
    name: "pairing routes",
    pattern: /\/pair\/(?:challenge|complete|auth-challenge|authenticate)/i,
  },
  { name: "pairing UI", pattern: /pair-device/i },
  {
    name: "TLS, certificate, firewall, and LAN discovery contracts",
    pattern: /\b(?:HostCertificateProvisioner|certificateTool|canonicalOrigin|canonicalPort|inspectPidexFirewall|applyPidexFirewall|advertisePidex|privateInterfaces|PidexAdvertisement|FirewallOperation|FirewallHealth|CertificateIntegration|FirewallIntegration|NetworkPort|PidexDnsSdAdvertisement|PrivateNetworkInterface)\b/,
  },
];

test("legacy PWA, pairing, and advisory push product paths are deleted", () => {
  for (const path of REMOVED_PRODUCT_PATHS) {
    assert.equal(existsSync(path), false, `${path} must be deleted`);
  }
});

test("active product code contains no removed identity or push surfaces", () => {
  const activeFiles = execFileSync("git", ["ls-files", "packages", "apps/client", "test"], {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean).filter(path =>
    existsSync(path) && !path.startsWith("apps/client/dist/") &&
    path !== "test/removed-identity-surfaces.test.ts"
  );

  for (const surface of REMOVED_SURFACES) {
    const violations = activeFiles.filter(path =>
      surface.pattern.test(readFileSync(path, "utf8"))
    );
    assert.deepEqual(violations, [], `${surface.name} must remain deleted`);
  }
});
