import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { ensureCertificate } from "../packages/host/src/certificate.js";
import { installForCurrentUser } from "../packages/launcher/src/installation.js";
import {
  STARTUP_BACKOFF_MS,
  superviseStartup,
  type StartupState,
} from "../packages/launcher/src/supervisor.js";

test("per-user updates preserve installation identity and configure certificate trust", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-install-"));
  const runtime = join(root, "node.exe");
  const adapter = adaptersFor("deterministic").windows;
  const calls: string[] = [];
  const windows = {
    ...adapter,
    restrictToCurrentUser: (path: string) => calls.push(`acl:${path}`),
    trustCurrentUserCertificate: (path: string) => calls.push(`trust:${path}`),
    registerLogonTask: (command: string) => calls.push(`task:${command}`),
  };
  try {
    await writeFile(runtime, "bundled runtime");
    const options = {
      installDir: join(root, "app"),
      releaseId: "1.0.0",
      signedRelease: true,
      bundledRuntime: runtime,
      windows,
    };
    const first = installForCurrentUser(options);
    const second = installForCurrentUser({ ...options, releaseId: "1.0.1" });
    assert.deepEqual(second, first);
    assert.match(first.hostname, /^pidex-[a-f0-9]{20}\.local$/);
    ensureCertificate(root, first.hostname, windows);
    assert.ok(calls.some(call => call.startsWith("task:")));
    assert.ok(calls.some(call => call.startsWith("trust:")));
    assert.deepEqual((await readdir(join(root, "tls"))).sort(), [
      "host-key.dpapi",
      "host.pem",
      "pidex-ca-key.dpapi",
      "pidex-ca.pem",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("per-user installation rejects an invalid durable identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-install-"));
  const installDir = join(root, "app");
  const runtime = join(root, "node.exe");

  try {
    await mkdir(installDir);
    await writeFile(runtime, "bundled runtime");
    await writeFile(join(installDir, "identity.json"), '{"schemaVersion":1}');

    assert.throws(
      () =>
        installForCurrentUser({
          installDir,
          releaseId: "1.0.0",
          signedRelease: true,
          bundledRuntime: runtime,
          windows: adaptersFor("deterministic").windows,
        }),
      /Installation identity is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup supervisor opens its circuit after all delayed retries fail", async () => {
  const delays: number[] = [];
  let visibleStatus: StartupState | undefined;
  const state = await superviseStartup({
    acquireUserLock: async () => true,
    startRelease: async deadline => {
      assert.equal(deadline, 15_000);
      throw new Error("release crashed");
    },
    sleep: async delay => {
      delays.push(delay);
    },
    reportStatus: async status => {
      visibleStatus = status;
    },
  });

  assert.deepEqual(delays, [...STARTUP_BACKOFF_MS]);
  assert.deepEqual(state, {
    state: "circuit-open",
    attempts: 6,
    cause: "release crashed",
  });
  assert.deepEqual(visibleStatus, state);
});

test("startup supervisor reports readiness without scheduling a retry", async () => {
  let visibleStatus: StartupState | undefined;
  const state = await superviseStartup({
    acquireUserLock: async () => true,
    startRelease: async deadline => {
      assert.equal(deadline, 15_000);
    },
    sleep: async () => {
      assert.fail("A ready release must not schedule a retry");
    },
    reportStatus: async status => {
      visibleStatus = status;
    },
  });

  assert.deepEqual(state, { state: "ready", attempts: 1 });
  assert.deepEqual(visibleStatus, state);
});
