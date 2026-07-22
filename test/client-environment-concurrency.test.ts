import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientEnvironment,
  IndexedDbClientEnvironmentStorage,
  MemoryClientEnvironmentStorage,
  type CommandEnvelope,
} from "../apps/client/src/client-environment.js";

test("IndexedDB storage does not open a notification channel when browser storage is unavailable", () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  let openedChannels = 0;
  class CountingBroadcastChannel {
    constructor() { openedChannels += 1; }
  }
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: CountingBroadcastChannel as unknown as typeof BroadcastChannel,
  });

  try {
    new IndexedDbClientEnvironmentStorage();
    assert.equal(openedChannels, 0);
  } finally {
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: originalBroadcastChannel,
    });
  }
});

test("shared Client environments preserve competing drafts and fence stale continuity writes", async () => {
  const storage = new MemoryClientEnvironmentStorage();
  const first = new ClientEnvironment(storage);
  const second = new ClientEnvironment(storage);
  const observed: number[] = [];
  second.subscribe(change => observed.push(change.revision));

  const initial = await first.readDraft("session-1");
  const competing = await second.readDraft("session-1");
  assert.deepEqual(await first.saveDraft("session-1", "first text", initial.revision, initial.generation), {
    kind: "saved", revision: 1,
  });
  const conflict = await second.saveDraft("session-1", "second text", competing.revision, competing.generation);
  assert.equal(conflict.kind, "conflict");
  assert.equal((await first.readDraft("session-1")).text, "first text");
  assert.deepEqual((await first.listDraftConflicts("session-1")).map(copy => copy.text), ["second text"]);

  const stale = (await first.readDraft("session-2")).generation;
  assert.equal(await second.advanceContinuity(), stale + 1);
  await assert.rejects(first.saveDraft("session-2", "old basis", 0, stale), /continuity changed/);
  assert.ok(observed.length >= 2);
});

test("convenience objects are last-completed-write wins and command journals are immutable and monotonic", async () => {
  const storage = new MemoryClientEnvironmentStorage();
  const first = new ClientEnvironment(storage);
  const second = new ClientEnvironment(storage);
  const generation = await first.continuityGeneration();

  await Promise.all([
    first.writePreference("layout", { density: "compact" }, generation),
    second.writePreference("layout", { density: "comfortable" }, generation),
  ]);
  assert.deepEqual(await first.readPreference("layout"), { density: "comfortable" });

  const envelope: CommandEnvelope = { version: 1, type: "run.submit", payload: { prompt: "hello" } };
  await first.reserveCommand("00000000-0000-4000-8000-000000000001", envelope, generation);
  await assert.rejects(
    second.reserveCommand("00000000-0000-4000-8000-000000000001", { ...envelope, payload: { prompt: "changed" } }, generation),
    /different envelope/,
  );
  await second.advanceCommand("00000000-0000-4000-8000-000000000001", "sent", generation);
  await first.advanceCommand("00000000-0000-4000-8000-000000000001", "uncertain", generation);
  await assert.rejects(second.advanceCommand("00000000-0000-4000-8000-000000000001", "reserved", generation), /cannot move backward/);
  assert.deepEqual((await second.unresolvedCommands()).map(entry => entry.envelope), [envelope]);

  const reconciled: CommandEnvelope[] = [];
  await second.reconcileUncertainCommands(true, async (_id, original) => {
    reconciled.push(original);
    return "terminal";
  });
  assert.deepEqual(reconciled, [envelope]);
  assert.deepEqual(await first.unresolvedCommands(), []);
});
