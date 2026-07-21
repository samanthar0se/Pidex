import assert from "node:assert/strict";
import test from "node:test";
import {
  createWindowsIntegrationPorts,
  type RawWindowsIntegrations,
} from "../packages/windows/src/index.js";

const certificate = {
  instanceId: "instance-1",
  certificatePath: "C:\\Pidex\\tls\\pidex-ca.pem",
  sha256: "a".repeat(64),
};
const task = {
  instanceId: "instance-1",
  owningSid: "S-1-5-21-1",
  name: "Pidex instance-1",
  executable: "C:\\Pidex\\pidex-launcher.exe",
  arguments: ["start", "--instance", "instance-1"],
};
const firewall = { instanceId: "instance-1", name: "Pidex instance-1", port: 47831 as const };

test("integration ports repair exact drift once and leave matching resources unchanged", async () => {
  const calls: string[] = [];
  let certificateInspection: unknown = { state: "drift", reasons: ["wrong-certificate"] };
  let taskInspection: unknown = { state: "absent", reasons: [] };
  let firewallInspection: unknown = { state: "drift", reasons: ["extra-profile", "wrong-port"] };
  const raw: RawWindowsIntegrations = {
    inspectCertificate: async () => certificateInspection,
    installCertificate: async () => { calls.push("certificate"); certificateInspection = { state: "matches", reasons: [] }; },
    removeCertificate: async () => undefined,
    inspectTask: async () => taskInspection,
    registerTask: async () => { calls.push("task"); taskInspection = { state: "matches", reasons: [] }; },
    removeTask: async () => undefined,
    inspectFirewallRule: async () => firewallInspection,
    ensureFirewallRule: async () => { calls.push("firewall"); firewallInspection = { state: "matches", reasons: [] }; },
    removeFirewallRule: async () => undefined,
  };
  const ports = createWindowsIntegrationPorts(raw);

  assert.equal((await ports.installation.ensureCertificate(certificate)).changed, true);
  assert.equal((await ports.installation.ensureTask(task)).changed, true);
  assert.equal((await ports.firewall.ensureCanonicalRule(firewall)).changed, true);
  assert.equal((await ports.installation.ensureCertificate(certificate)).changed, false);
  assert.equal((await ports.installation.ensureTask(task)).changed, false);
  assert.equal((await ports.firewall.ensureCanonicalRule(firewall)).changed, false);
  assert.deepEqual(calls, ["certificate", "task", "firewall"]);
});

test("source preparation exposes certificate and firewall integration but no task mutation", () => {
  const ports = createWindowsIntegrationPorts({} as RawWindowsIntegrations);
  assert.deepEqual(Object.keys(ports.sourcePreparation).sort(), [
    "ensureCertificate", "ensureFirewallRule", "inspectCertificate", "inspectFirewallRule",
  ]);
  assert.equal("ensureTask" in ports.sourcePreparation, false);
});

test("canonical firewall input cannot broaden profile, port, protocol, direction, or action", async () => {
  const ports = createWindowsIntegrationPorts({
    inspectFirewallRule: async () => assert.fail("invalid policy must not reach native code"),
  } as unknown as RawWindowsIntegrations);
  await assert.rejects(
    ports.firewall.inspectCanonicalRule({ ...firewall, port: 80, profile: "Any" } as never),
    /unrecognized key|expected 47831/i,
  );
});
