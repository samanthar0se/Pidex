import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HostLifecycleError,
  coordinatePlannedLifecycle,
  coordinateWindowsShutdown,
  type LifecycleHooks,
} from "../packages/launcher/src/host-lifecycle.js";

function hooks(events: string[], quiescent: () => boolean): LifecycleHooks {
  return {
    rejectMutations: () => { events.push("drain"); },
    resumeMutations: () => { events.push("resume"); },
    remainingWork: () => quiescent() ? [] : ["run:executing"],
    reportRemainingWork: work => { events.push(`remaining:${work.length}`); },
    stopAffectedSessions: () => { events.push("durable-stop"); },
    flushAndStopWorkers: () => { events.push("flush"); },
    restart: () => { events.push("restart"); },
    sleep: async () => {},
    now: () => 10,
  };
}

test("planned lifecycle drains, reports blockers, and never silently forces", async () => {
  const events: string[] = [];
  await assert.rejects(
    coordinatePlannedLifecycle({
      operation: "stop",
      hooks: hooks(events, () => false),
      timeoutMs: 0,
    }),
    (error: unknown) => error instanceof HostLifecycleError && error.code === "drain-timeout",
  );
  assert.deepEqual(events, ["drain", "remaining:1", "resume"]);
});

test("explicit force durably stops Sessions before worker Job closure", async () => {
  const events: string[] = [];
  await coordinatePlannedLifecycle({
    operation: "restart",
    force: true,
    hooks: hooks(events, () => true),
  });
  assert.deepEqual(events, ["drain", "durable-stop", "remaining:0", "flush", "restart", "resume"]);
});

test("normal uninstall removes product bytes but preserves same-user durable data", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-uninstall-"));
  const install = join(root, "app");
  const cache = join(root, "cache");
  const data = join(root, "data");
  await Promise.all([mkdir(install), mkdir(cache), mkdir(data)]);
  await writeFile(join(data, "identity.json"), "durable");
  const events: string[] = [];

  await coordinatePlannedLifecycle({
    operation: "uninstall",
    hooks: {
      ...hooks(events, () => true),
      removeStartupRegistration: () => { events.push("task"); },
      removeFirewallRules: () => { events.push("firewall"); },
      removeCurrentUserRootTrust: () => { events.push("trust"); },
    },
    uninstall: { installDirectory: install, disposableCaches: [cache], durableDataDirectory: data },
  });
  await assert.rejects(access(install));
  await assert.rejects(access(cache));
  assert.equal(await access(join(data, "identity.json")), undefined);
  assert.deepEqual(events, ["drain", "remaining:0", "flush", "task", "firewall", "trust"]);
});

test("Windows shutdown uses bounded cooperative work then closes the containing Job", async () => {
  const events: string[] = [];
  await coordinateWindowsShutdown({
    rejectMutations: () => { events.push("reject"); },
    flushAndCooperativelyAbort: async () => new Promise(() => {}),
    closeSupervisionJob: () => { events.push("job-close"); },
    budgetMs: 1,
  });
  assert.deepEqual(events, ["reject", "job-close"]);
});
