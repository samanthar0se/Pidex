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
    createPairing: async () => ({ secret: "PAIRING-SECRET", expiresAt: 123 }),
    revokeDevice: async deviceId => { calls.push(`revoke:${deviceId}`); },
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

test("pairing and revocation use live authority and pairing secrets use only approved output channels", async () => {
  const calls: string[] = [];
  const written: string[] = [];
  const live = new ExactIntegrationControl({ state: "live", owner: owner(calls) });
  const maintenance = new ExactIntegrationControl({ state: "maintenance", owner: owner([]) });

  const result = await live.pair({
    channel: "inherited-secret-handle",
    writeSecret: async secret => { written.push(secret); },
  });
  await live.revoke("device-1");

  assert.deepEqual(result, { expiresAt: 123 });
  assert.deepEqual(written, ["PAIRING-SECRET"]);
  assert.equal(JSON.stringify(result).includes("PAIRING-SECRET"), false);
  assert.deepEqual(calls, ["revoke:device-1"]);
  await assert.rejects(
    live.pair({ channel: "redirected-stdout", writeSecret: async () => undefined } as never),
    /approved pairing output channel/,
  );
  await assert.rejects(
    maintenance.pair({ channel: "interactive-console", writeSecret: async () => undefined }),
    /live Host authority/,
  );
  await assert.rejects(maintenance.revoke("device-1"), /live Host authority/);
});
