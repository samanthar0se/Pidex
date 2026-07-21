import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HostLifecycleError,
  FORCE_LIFECYCLE_CONFIRMATION,
  PURGE_CONFIRMATION,
  coordinatePlannedLifecycle,
  coordinateWindowsShutdown,
  type LifecycleHooks,
} from "../packages/launcher/src/host-lifecycle.js";

function lifecycleHooks(
  events: string[],
  isQuiescent: () => boolean,
): LifecycleHooks {
  return {
    rejectMutations: () => {
      events.push("drain");
    },
    resumeMutations: () => {
      events.push("resume");
    },
    remainingWork: () => (isQuiescent() ? [] : ["run:executing"]),
    reportRemainingWork: work => {
      events.push(`remaining:${work.length}`);
    },
    forceStopAffectedSessions: () => {
      events.push("durable-stop");
    },
    flushAndStopWorkers: () => {
      events.push("flush");
    },
    restart: () => {
      events.push("restart");
    },
    sleep: async () => {},
    now: () => 10,
  };
}

test("planned lifecycle drains, reports blockers, and never silently forces", async () => {
  const events: string[] = [];
  await assert.rejects(
    coordinatePlannedLifecycle({
      operation: "stop",
      hooks: lifecycleHooks(events, () => false),
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
    forceConfirmation: FORCE_LIFECYCLE_CONFIRMATION,
    hooks: lifecycleHooks(events, () => true),
  });
  assert.deepEqual(events, [
    "drain",
    "durable-stop",
    "remaining:0",
    "flush",
    "restart",
    "resume",
  ]);
});

test("force is a separately confirmed lifecycle operation", async () => {
  const events: string[] = [];
  await assert.rejects(
    coordinatePlannedLifecycle({
      operation: "stop",
      force: true,
      hooks: lifecycleHooks(events, () => true),
    }),
    (error: unknown) =>
      error instanceof HostLifecycleError && error.code === "force-not-confirmed",
  );
  assert.deepEqual(events, []);
});

test("normal uninstall removes product bytes but preserves same-user durable data", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-uninstall-"));
  try {
    const install = join(root, "app");
    const cache = join(root, "cache");
    const data = join(root, "data");
    await Promise.all([mkdir(install), mkdir(cache), mkdir(data)]);
    await writeFile(join(data, "identity.json"), "durable");
    const events: string[] = [];

    await coordinatePlannedLifecycle({
      operation: "uninstall",
      hooks: {
        ...lifecycleHooks(events, () => true),
        removeStartupRegistration: () => {
          events.push("task");
        },
        removeFirewallRules: () => {
          events.push("firewall");
        },
        removeCurrentUserRootTrust: () => {
          events.push("trust");
        },
      },
      uninstall: {
        installDirectory: install,
        disposableCaches: [cache],
        durableDataDirectory: data,
      },
    });
    await assert.rejects(access(install));
    await assert.rejects(access(cache));
    assert.equal(await access(join(data, "identity.json")), undefined);
    assert.deepEqual(events, [
      "drain",
      "remaining:0",
      "flush",
      "task",
      "firewall",
      "trust",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("purge requires explicit confirmation and backup acknowledgement", async () => {
  const events: string[] = [];

  await assert.rejects(
    coordinatePlannedLifecycle({
      operation: "purge",
      hooks: lifecycleHooks(events, () => true),
      purgeConfirmation: PURGE_CONFIRMATION,
      backupConsequencesAcknowledged: false,
    }),
    (error: unknown) =>
      error instanceof HostLifecycleError && error.code === "purge-not-confirmed",
  );
  assert.deepEqual(events, []);
});

test("confirmed purge removes product bytes and durable data", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-purge-"));
  try {
    const install = join(root, "app");
    const data = join(root, "data");
    await Promise.all([mkdir(install), mkdir(data)]);
    await writeFile(join(data, "identity.json"), "durable");
    const events: string[] = [];

    await coordinatePlannedLifecycle({
      operation: "purge",
      hooks: lifecycleHooks(events, () => true),
      uninstall: {
        installDirectory: install,
        durableDataDirectory: data,
      },
      purgeConfirmation: PURGE_CONFIRMATION,
      backupConsequencesAcknowledged: true,
    });

    await assert.rejects(access(install));
    await assert.rejects(access(data));
    assert.deepEqual(events, ["drain", "remaining:0", "flush"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows shutdown uses bounded cooperative work then closes the containing Job", async () => {
  const events: string[] = [];
  await coordinateWindowsShutdown({
    rejectMutations: () => {
      events.push("reject");
    },
    flushAndCooperativelyAbort: async () => new Promise(() => {}),
    closeSupervisionJob: () => {
      events.push("job-close");
    },
    budgetMs: 1,
  });
  assert.deepEqual(events, ["reject", "job-close"]);
});
