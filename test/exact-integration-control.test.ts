import assert from "node:assert/strict";
import test from "node:test";
import {
  ExactIntegrationControl,
  type ExactIntegrationPolicyOwner,
  type ExactIntegrationTarget,
} from "../packages/host/src/exact-integration-control.js";

function owner(calls: string[]): ExactIntegrationPolicyOwner {
  const inspect = (target: ExactIntegrationTarget, state: string) => async () => {
    calls.push(`inspect:${target}`);
    return { state };
  };
  const repair = (target: ExactIntegrationTarget) => async () => {
    calls.push(`repair:${target}`);
    return { changed: true };
  };

  return {
    inspectOrigin: inspect("origin", "matches"),
    repairOrigin: repair("origin"),
    inspectCertificate: inspect("certificate", "drift"),
    repairCertificate: repair("certificate"),
    inspectPrivateNetwork: inspect("private-network", "matches"),
    repairPrivateNetwork: repair("private-network"),
    inspectFirewall: inspect("firewall", "drift"),
    repairFirewall: repair("firewall"),
  };
}

test("inspection reaches only the selected live policy owner operation and never repairs", async () => {
  const calls: string[] = [];
  const control = new ExactIntegrationControl({ state: "live", owner: owner(calls) });

  assert.deepEqual(await control.inspect("certificate"), { state: "drift" });
  assert.deepEqual(calls, ["inspect:certificate"]);
});
test("repair reaches only one exact integration on the selected live or maintenance owner", async () => {
  const liveCalls: string[] = [];
  const maintenanceCalls: string[] = [];
  const live = new ExactIntegrationControl({ state: "live", owner: owner(liveCalls) });
  const maintenance = new ExactIntegrationControl({ state: "maintenance", owner: owner(maintenanceCalls) });

  assert.deepEqual(await live.repair("firewall"), { changed: true });
  assert.deepEqual(await maintenance.repair("origin"), { changed: true });
  assert.deepEqual(liveCalls, ["repair:firewall"]);
  assert.deepEqual(maintenanceCalls, ["repair:origin"]);
});
