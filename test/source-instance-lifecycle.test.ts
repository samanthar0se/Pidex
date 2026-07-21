import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  prepareSourceInstance,
  unprepareSourceInstance,
} from "../packages/source/src/source-instance.js";

test("source prepare rejects a different elevation identity before filesystem or integration mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-instance-"));
  const checkoutDirectory = join(root, "checkout");
  const profileDirectory = join(root, "profile");
  let integrationCalls = 0;

  await assert.rejects(
    prepareSourceInstance({
      checkoutDirectory,
      profileDirectory,
      identity: {
        owningSid: "S-1-5-21-100",
        tokenSid: "S-1-5-21-200",
        administrator: true,
        elevated: true,
        appContainer: false,
      },
      integrations: {
        ensureCertificate: async () => { integrationCalls += 1; return matching(); },
        ensureFirewallRule: async () => { integrationCalls += 1; return matching(); },
      },
      createTlsMaterial: async () => {
        integrationCalls += 1;
        return { caCertificate: "certificate", caPrivateKey: "ca-key", hostCertificate: "host", hostPrivateKey: "host-key" };
      },
    }),
    /same owning Windows identity/i,
  );

  assert.equal(integrationCalls, 0);
  assert.equal(existsSync(checkoutDirectory), false);
  assert.equal(existsSync(profileDirectory), false);
});

function matching() {
  return { changed: false, inspection: { state: "matches" as const, reasons: [] } };
}

test("source prepare is idempotent and copied markers intentionally resolve the same profile instance", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-instance-"));
  const profileDirectory = join(root, "profile");
  const firstCheckout = join(root, "first");
  const copiedCheckout = join(root, "copied");
  const freshCheckout = join(root, "fresh");
  const ensured: string[] = [];
  let tlsCreations = 0;
  const options = (checkoutDirectory: string) => ({
    checkoutDirectory,
    profileDirectory,
    identity: validIdentity(),
    integrations: {
      ensureCertificate: async () => { ensured.push("certificate"); return matching(); },
      ensureFirewallRule: async () => { ensured.push("firewall"); return matching(); },
    },
    createTlsMaterial: async () => {
      tlsCreations += 1;
      return { caCertificate: "certificate", caPrivateKey: "ca-key", hostCertificate: "host", hostPrivateKey: "host-key" };
    },
  });

  const first = await prepareSourceInstance(options(firstCheckout));
  const repeated = await prepareSourceInstance(options(firstCheckout));
  mkdirSync(copiedCheckout);
  copyFileSync(first.markerPath, join(copiedCheckout, ".pidex-source-instance.json"));
  const copied = await prepareSourceInstance(options(copiedCheckout));
  const fresh = await prepareSourceInstance(options(freshCheckout));

  assert.equal(repeated.instanceId, first.instanceId);
  assert.equal(copied.instanceId, first.instanceId);
  assert.equal(copied.sourceRoot, first.sourceRoot);
  assert.notEqual(fresh.instanceId, first.instanceId);
  assert.notEqual(fresh.sourceRoot, first.sourceRoot);
  assert.equal(tlsCreations, 2);
  assert.deepEqual(ensured, ["certificate", "firewall", "certificate", "firewall", "certificate", "firewall", "certificate", "firewall"]);
  assert.equal(Buffer.from(readFileSync(join(first.sourceRoot, "control", "control.key"))).byteLength, 32);
  assert.equal(readFileSync(join(first.sourceRoot, "tls", "pidex-ca-key.pem"), "utf8"), "ca-key");
});

function validIdentity() {
  return {
    owningSid: "S-1-5-21-100",
    tokenSid: "S-1-5-21-100",
    administrator: true,
    elevated: true,
    appContainer: false,
  };
}

test("source unprepare removes only exact trust and firewall integrations while preserving all source state", async () => {
  const root = mkdtempSync(join(tmpdir(), "pidex-source-instance-"));
  const checkoutDirectory = join(root, "checkout");
  const profileDirectory = join(root, "profile");
  const removed: Array<{ kind: string; input: unknown }> = [];
  const integrations = {
    ensureCertificate: async () => matching(),
    ensureFirewallRule: async () => matching(),
    removeCertificate: async (input: unknown) => { removed.push({ kind: "certificate", input }); },
    removeFirewallRule: async (input: unknown) => { removed.push({ kind: "firewall", input }); },
  };
  const prepared = await prepareSourceInstance({
    checkoutDirectory,
    profileDirectory,
    identity: validIdentity(),
    integrations,
    createTlsMaterial: async () => ({ caCertificate: "certificate", caPrivateKey: "ca-key", hostCertificate: "host", hostPrivateKey: "host-key" }),
  });

  await unprepareSourceInstance({ checkoutDirectory, profileDirectory, identity: validIdentity(), integrations });

  assert.equal(removed.length, 2);
  assert.deepEqual(removed.map(item => item.kind), ["certificate", "firewall"]);
  assert.deepEqual(removed[1]!.input, {
    instanceId: prepared.instanceId,
    name: `Pidex Source ${prepared.instanceId}`,
    port: 47831,
  });
  assert.equal(existsSync(prepared.markerPath), true);
  assert.equal(existsSync(join(prepared.sourceRoot, "instance.json")), true);
  assert.equal(existsSync(join(prepared.sourceRoot, "control", "control.key")), true);
  assert.equal(existsSync(join(prepared.sourceRoot, "tls", "pidex-ca-key.pem")), true);
  assert.equal(existsSync(join(prepared.sourceRoot, "releases")), true);
});
