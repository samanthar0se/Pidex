import assert from "node:assert/strict";
import test from "node:test";
import {
  createNetworkPort,
  type NativeNetworkBinding,
  WindowsPlatformError,
} from "../packages/windows/src/index.js";

test("the Network port excludes Public and DomainAuthenticated interfaces from snapshots and advertisements", async () => {
  let advertised: unknown;
  const native: NativeNetworkBinding = {
    snapshotInterfaces: async () => [
      { id: "private", name: "Wi-Fi", addresses: ["192.168.1.8"], profile: "private" },
      { id: "public", name: "Cafe", addresses: ["10.0.0.8"], profile: "public" },
      { id: "domain", name: "Corp", addresses: ["172.16.0.8"], profile: "domain-authenticated" },
    ],
    observeInterfaces: async () => ({ close: async () => undefined }),
    openAdvertisement: async input => {
      advertised = input;
      return { close: async () => undefined };
    },
  };
  const port = createNetworkPort(native);

  const interfaces = await port.snapshotPrivateInterfaces();
  assert.deepEqual(interfaces.map(value => value.id), ["private"]);

  const advertisement = await port.openAdvertisement({
    service: "_pidex._tcp.local",
    hostname: "pidex-example.local",
    port: 47831,
    interfaces,
    txt: {
      location: "https://pidex-example.local:47831",
      label: "My Pidex",
      version: "1",
      fingerprint: "0123456789abcdef",
    },
  });
  assert.deepEqual(
    (advertised as { interfaces: Array<{ id: string }> }).interfaces.map(value => value.id),
    ["private"],
  );
  await advertisement.close();
});

test("Private-interface observation and advertisement close are idempotent and suppress racing callbacks", async () => {
  let changed!: (snapshot: unknown) => void;
  let observerFault!: (fault: unknown) => void;
  let advertisementFault!: (fault: unknown) => void;
  let observerCloses = 0;
  let advertisementCloses = 0;
  const native: NativeNetworkBinding = {
    snapshotInterfaces: async () => [],
    observeInterfaces: async (onChange, onFault) => {
      changed = onChange;
      observerFault = onFault;
      return {
        close: async () => {
          observerCloses += 1;
          changed([{ id: "late", name: "Late", addresses: ["192.168.1.9"], profile: "private" }]);
        },
      };
    },
    openAdvertisement: async (_input, onFault) => {
      advertisementFault = onFault!;
      return { close: async () => { advertisementCloses += 1; } };
    },
  };
  const port = createNetworkPort(native);
  const snapshots: string[][] = [];
  const observer = await port.observePrivateInterfaces(snapshot => {
    snapshots.push(snapshot.map(value => value.id));
  });

  changed([
    { id: "public", name: "Cafe", addresses: ["10.0.0.8"], profile: "public" },
    { id: "private", name: "Home", addresses: ["192.168.1.8"], profile: "private" },
  ]);
  observerFault({
    operation: "network-observer",
    category: "unavailable",
    domain: "hresult",
    code: -1,
    retryable: true,
    detail: "NLM subscription ended",
  });
  const fault = await observer.lateFault;
  assert.ok(fault instanceof WindowsPlatformError);
  assert.equal(fault.operation, "network-observer");
  await Promise.all([observer.close(), observer.close()]);
  changed([{ id: "later", name: "Later", addresses: ["192.168.1.10"], profile: "private" }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(snapshots, [["private"]]);
  assert.equal(observerCloses, 1);

  const interfaces = [{ id: "private", name: "Home", addresses: ["192.168.1.8"], profile: "private" as const }];
  const advertisement = await port.openAdvertisement(advertisementInput(interfaces));
  advertisementFault({ operation: "dns-register", category: "conflict", domain: "dns", code: 9709, retryable: true, detail: "name conflict" });
  assert.equal((await advertisement.lateFault).domain, "dns");
  await Promise.all([advertisement.close(), advertisement.close()]);
  assert.equal(advertisementCloses, 1);
});

function advertisementInput(interfaces: Array<{ id: string; name: string; addresses: string[]; profile: "private" }>) {
  return {
    service: "_pidex._tcp.local" as const,
    hostname: "pidex-example.local",
    port: 47831,
    interfaces,
    txt: { location: "https://pidex-example.local:47831", label: "My Pidex", version: "1", fingerprint: "0123456789abcdef" },
  };
}
