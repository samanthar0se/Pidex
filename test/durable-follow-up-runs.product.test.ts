import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor, type PiAdapter, type PiExecuteResult } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { AuthorityStore } from "../packages/host/src/store.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

interface PendingExecution {
  prompt: string;
  resolve(value: PiExecuteResult): void;
  reject(error: Error): void;
}

test("durable follow-ups execute once in order and are held after an abnormal predecessor", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-queue-"));
  const pending: PendingExecution[] = [];
  const base = adaptersFor("deterministic");
  const pi: PiAdapter = {
    ...base.pi,
    execute: request =>
      new Promise((resolve, reject) => {
        pending.push({ prompt: request.prompt, resolve, reject });
      }),
  };
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters: { ...base, pi },
  });
  try {
    const controlOrigin = host.origin.replace("https:", "wss:");
    const socket = new WebSocket(`${controlOrigin}/control`, {
      rejectUnauthorized: false,
      headers: { authorization: "Bearer device" },
    });
    await negotiateControl(socket);
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") {
      throw new Error("missing session");
    }
    const sessionChange = created.changes[0];
    assert.ok(sessionChange);
    const sessionId = sessionChange.session.sessionId;

    const submit = (
      type: "run.submit" | "run.follow-up",
      commandId: string,
      prompt: string,
    ) => {
      socket.send(JSON.stringify({
        type,
        commandId,
        sessionId,
        prompt,
        requiredCapability: type,
      }));
    };
    submit("run.submit", "one", "one");
    assert.equal((await nextControlMessage(socket)).type, "command.outcome");
    submit("run.follow-up", "two", "two");
    const two = await nextControlMessage(socket);
    submit("run.follow-up", "three", "three");
    await nextControlMessage(socket);
    assert.deepEqual(pending.map(item => item.prompt), ["one"]);

    const firstExecution = pending.shift();
    assert.ok(firstExecution);
    firstExecution.resolve({ text: "done one", checkpoint: "cp1" });
    await nextControlMessage(socket);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(pending.map(item => item.prompt), ["two"]);
    const secondExecution = pending.shift();
    assert.ok(secondExecution);
    secondExecution.reject(new Error("failed two"));
    await nextControlMessage(socket);

    socket.send(JSON.stringify({ type: "scope.set", sessionIds: [sessionId], protocolVersion: "1.1" }));
    await nextControlMessage(socket); // host reset
    const scope = await nextControlMessage(socket);
    assert.equal(scope.type, "scope.reset");
    if (scope.type !== "scope.reset" || !("runs" in scope.snapshot)) {
      throw new Error("missing runs");
    }
    const runs = scope.snapshot.runs;
    assert.ok(runs);
    assert.deepEqual(
      runs.map(run => run.state),
      ["completed", "failed", "held"],
    );

    const held = runs[2];
    assert.ok(held);
    socket.send(JSON.stringify({
      type: "run.release",
      commandId: "release",
      runId: held.runId,
    }));
    assert.equal((await nextControlMessage(socket)).type, "command.outcome");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(pending.map(item => item.prompt), ["three"]);
    assert.equal(two.type, "command.outcome");
    if (two.type !== "command.outcome") {
      throw new Error("missing follow-up outcome");
    }
    assert.equal(two.outcome, "accepted");
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an undispatched follow-up survives restart held and can be cancelled without dispatch", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-held-"));
  const adapters = adaptersFor("deterministic");
  try {
    let store = new AuthorityStore(join(dataDir, "authority.sqlite"), adapters);
    const session = store.createSession(null, null, 1).session;
    const first = store.submitRun(
      "device",
      {
        commandId: "one",
        sessionId: session.sessionId,
        prompt: "one",
        requiredCapability: "run.submit",
      },
      2,
    );
    const next = store.submitRun(
      "device",
      {
        commandId: "two",
        sessionId: session.sessionId,
        prompt: "two",
        requiredCapability: "run.follow-up",
      },
      3,
    );
    assert.equal(first.kind, "accepted");
    assert.equal(next.kind, "accepted");
    store.close();

    store = new AuthorityStore(join(dataDir, "authority.sqlite"), adapters);
    store.reconcileAcceptedRuns(4);
    assert.deepEqual(store.runs(session.sessionId).map(run => run.state), ["interrupted", "held"]);
    if (next.kind !== "accepted") throw new Error("missing follow-up");
    store.cancelQueuedRun(next.run.runId, 5);
    assert.deepEqual(store.runs(session.sessionId).map(run => run.state), ["interrupted", "cancelled"]);
    assert.equal(store.dispatchNext(session.sessionId), undefined);
    store.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
