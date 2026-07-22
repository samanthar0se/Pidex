import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const REMOVED_NETWORK_SECURITY_PATHS = [
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

const REMOVED_NETWORK_SECURITY_PATTERN =
  /\b(?:HostCertificateProvisioner|certificateTool|canonicalOrigin|canonicalPort|inspectPidexFirewall|applyPidexFirewall|advertisePidex|privateInterfaces|PidexAdvertisement|FirewallOperation|FirewallHealth|CertificateIntegration|FirewallIntegration|NetworkPort|PidexDnsSdAdvertisement|PrivateNetworkInterface)\b/;

test("TLS, certificate, firewall, and LAN discovery product paths are deleted", () => {
  for (const path of REMOVED_NETWORK_SECURITY_PATHS) {
    assert.equal(existsSync(path), false, `${path} must be deleted`);
  }
});

test("active product code contains no removed TLS, certificate, firewall, or LAN discovery contracts", () => {
  const activeFiles = execFileSync(
    "git",
    ["ls-files", "packages", "apps/client", "test"],
    { encoding: "utf8" },
  ).trim().split("\n").filter(Boolean).filter(path =>
    existsSync(path) && !path.startsWith("apps/client/dist/") &&
    path !== "test/removed-network-security-surfaces.test.ts"
  );

  const violations = activeFiles.filter(path =>
    REMOVED_NETWORK_SECURITY_PATTERN.test(readFileSync(path, "utf8"))
  );
  assert.deepEqual(
    violations,
    [],
    "TLS, certificate, firewall, and LAN discovery contracts must remain deleted",
  );
});
