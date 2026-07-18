import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AdvisoryPush,
  decryptPushHint,
  type PushFact,
} from "../packages/host/src/advisory-push.js";

const interaction: PushFact = {
  category: "interaction",
  eventId: "interaction:i-1:open:1",
  hostId: "host-1",
  occurredAt: "2026-07-18T12:00:00.000Z",
  path: "/sessions/s-1?interaction=i-1",
  preview: "Choose a deployment target",
};

test("push is explicit, filtered, private, bounded, and advisory", async () => {
  const sent: Uint8Array[] = [];
  const key = randomBytes(32);
  const push = new AdvisoryPush(async (_subscription, payload) => {
    sent.push(payload);
  });

  push.configure("device-1", {
    enabled: true,
    privacy: "generic",
    categories: { interaction: true, run: true, held: true, piProblem: true },
    subscription: "opaque-browser-subscription",
    encryptionKey: key,
  });
  await push.publish(interaction);
  await push.publish(interaction); // stable Host event identity deduplicates
  await push.publish({ ...interaction, eventId: "output:1", category: "routine" });

  assert.equal(sent.length, 1);
  assert.ok(sent[0]!.byteLength <= 4096);
  assert.doesNotMatch(Buffer.from(sent[0]!).toString(), /deployment target/);
  assert.deepEqual(decryptPushHint(sent[0]!, key), {
    version: 1,
    eventId: interaction.eventId,
    hostId: interaction.hostId,
    occurredAt: interaction.occurredAt,
    category: "interaction",
    path: interaction.path,
    title: "Pidex needs attention",
    body: "Open Pidex to reconcile current state.",
  });
});

test("unsupported, denied, disabled, outage, and missed deadline never affect Host facts", async () => {
  const push = new AdvisoryPush(async () => {
    throw Error("push service offline");
  });
  const key = randomBytes(32);

  assert.equal(await push.publish(interaction), 0); // unsupported/unconfigured
  push.configure("denied", { enabled: false, permission: "denied" });
  assert.equal(await push.publish(interaction), 0);
  push.configure("online-later", {
    enabled: true,
    privacy: "rich",
    categories: { interaction: true },
    subscription: "subscription",
    encryptionKey: key,
  });
  assert.equal(await push.publish(interaction), 0); // best effort, no retry/authority
  assert.equal(push.deliveryFailures("online-later"), 1);
});

test("revocation stops scheduling and permits at most one final encrypted hint", async () => {
  const sent: Uint8Array[] = [];
  const key = randomBytes(32);
  const push = new AdvisoryPush(async (_subscription, payload) => {
    sent.push(payload);
  });
  push.configure("device-1", {
    enabled: true,
    subscription: "subscription",
    encryptionKey: key,
  });

  assert.equal(await push.revoke("device-1", {
    eventId: "revocation:device-1",
    hostId: "host-1",
    occurredAt: "2026-07-18T12:00:00.000Z",
  }), true);
  assert.equal(await push.publish(interaction), 0);
  assert.equal(await push.revoke("device-1"), false);
  assert.equal(sent.length, 1);
  assert.equal(decryptPushHint(sent[0]!, key).category, "revocation");
});

test("worker deduplicates delayed/foreground hints and click only opens then reconciles", async () => {
  const worker = await readFile("apps/pwa/service-worker.js", "utf8");
  const app = await readFile("apps/pwa/app.js", "utf8");

  assert.match(worker, /eventId/);
  assert.match(worker, /pidex-push-receipts/);
  assert.match(worker, /visibilityState === "visible"/);
  assert.match(worker, /push-reconcile/);
  assert.doesNotMatch(worker, /notification.*(?:run\.submit|interaction\.resolve)/s);
  assert.match(app, /push-reconcile/);
  assert.match(app, /Notification\.permission/);
  assert.match(app, /privacy = "rich"/);
});
