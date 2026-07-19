import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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
    const certificate = ensureCertificate(root, first.hostname, windows);
    assert.ok(calls.some(call => call.startsWith("task:")));
    assert.ok(calls.some(call => call.startsWith("trust:")));
    assert.deepEqual((await readdir(join(root, "tls"))).sort(), [
      "Generation",
      "generations",
    ]);
    const generation = (
      await readFile(join(root, "tls", "Generation"), "utf8")
    ).trim();
    assert.deepEqual(
      (
        await readdir(join(root, "tls", "generations", generation))
      ).sort(),
      [
        "host-key.dpapi",
        "host.pem",
        "identity.json",
        "pidex-ca-key.dpapi",
        "pidex-ca.pem",
      ],
    );

    await writeFile(join(root, "tls", "Generation"), "damaged-selector");
    assert.deepEqual(ensureCertificate(root, first.hostname, windows), certificate);
    assert.equal(
      (await readFile(join(root, "tls", "Generation"), "utf8")).trim(),
      generation,
    );
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

test("certificate identity changes regenerate a leaf valid for an IPv4 origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-certificate-ip-"));
  const windows = adaptersFor("deterministic").windows;

  try {
    ensureCertificate(root, "localhost", windows);
    const initialCa = await readFile(await selectedTlsFile(root, "pidex-ca.pem"));

    ensureCertificate(root, "192.168.1.227", windows);
    const certificate = new X509Certificate(
      await readFile(await selectedTlsFile(root, "host.pem")),
    );
    const replacementCa = await readFile(
      await selectedTlsFile(root, "pidex-ca.pem"),
    );

    assert.equal(certificate.checkIP("192.168.1.227"), "192.168.1.227");
    assert.deepEqual(replacementCa, initialCa);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TLS selection refuses mixed retained generation material", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-tls-"));
  const windows = adaptersFor("deterministic").windows;
  try {
    ensureCertificate(root, "pidex-test.local", windows);
    await writeFile(await selectedTlsFile(root, "host.pem"), "not the leaf");
    assert.throws(
      () => ensureCertificate(root, "pidex-test.local", windows),
      /TLS generation/,
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

test("launcher contains the daemon before readiness and closes its Job after repeated failure", async () => {
  const events: string[] = [];
  const state = await superviseStartup({
    acquireUserLock: async () => true,
    createDaemonSupervisionJob: async () => ({
      assignDaemon: async () => {
        events.push("assigned");
      },
      close: () => {
        events.push("closed");
      },
    }),
    startRelease: async (_deadline, supervisionJob) => {
      assert.ok(supervisionJob);
      events.push("started");
      throw new Error("crashed");
    },
    sleep: async () => {},
  });

  assert.equal(state.state, "circuit-open");
  assert.deepEqual(events, [
    "assigned",
    "started",
    "started",
    "started",
    "started",
    "started",
    "started",
    "closed",
  ]);
});

async function selectedTlsFile(root: string, name: string): Promise<string> {
  const generation = (
    await readFile(join(root, "tls", "Generation"), "utf8")
  ).trim();
  return join(root, "tls", "generations", generation, name);
}
