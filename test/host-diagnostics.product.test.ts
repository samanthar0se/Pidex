import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DiagnosticCenter,
  LocalLaunchCapabilities,
  StructuredDiagnosticLog,
  type DiagnosticProbes,
} from "../packages/host/src/diagnostics.js";

const probesWithVersionMismatch: DiagnosticProbes = {
  versions: () => ({
    ok: false,
    cause: "launcher-daemon-mismatch",
    action: "repair Pidex",
  }),
  database: () => ({ ok: true }),
  certificates: () => ({ ok: true }),
  network: () => ({ ok: true }),
  firewall: () => ({ ok: true }),
  mdns: () => ({ ok: true }),
  update: () => ({ ok: true }),
  workers: () => ({ ok: true }),
  storage: () => ({ ok: true }),
  circuitBreaker: () => ({ ok: true }),
};

test("doctor reports typed failures with complete progress", async () => {
  const center = new DiagnosticCenter({
    root: "/unused",
    maximumBytes: 5_000,
    probes: probesWithVersionMismatch,
  });

  const report = await center.doctor();

  assert.equal(report.checks[0]?.cause, "launcher-daemon-mismatch");
  assert.equal(report.progress, 1);
});

test(
  "diagnostic logs stay bounded and support evidence excludes coding content by default",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pidex-diagnostics-"));
    try {
      const center = new DiagnosticCenter({
        root,
        maximumBytes: 5_000,
        probes: probesWithVersionMismatch,
      });

      const log = new StructuredDiagnosticLog(root, { maximumBytes: 800 });
      for (let index = 0; index < 30; index++) {
        log.write({
          area: "worker",
          cause: "probe-failed",
          detail: `safe-${index}`,
          prompt: "FORBIDDEN PROMPT",
        });
      }
      assert.ok(
        (await readFile(join(root, "diagnostics.jsonl"))).byteLength <= 800,
      );
      await writeFile(
        join(root, "crash.json"),
        JSON.stringify({ secret: "FORBIDDEN SECRET", cause: "crash" }),
      );

      const bundle = await center.exportSupport({ includeContent: false });
      const exported = await readFile(bundle.path, "utf8");

      assert.doesNotMatch(exported, /FORBIDDEN|prompt|secret|\/home\//i);
      assert.ok(bundle.bytes <= 5_000);
      assert.equal(center.outboundTransmissions, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("local launch capabilities are single-use and restricted to loopback", () => {
  const capabilities = new LocalLaunchCapabilities(() => 100);
  const recoveryCapability = capabilities.issue("recovery", 10);

  assert.equal(
    capabilities.consume(recoveryCapability, "recovery", "127.0.0.1"),
    true,
  );
  assert.equal(
    capabilities.consume(recoveryCapability, "recovery", "127.0.0.1"),
    false,
  );

  const setupCapability = capabilities.issue("setup", 10);
  assert.equal(
    capabilities.consume(setupCapability, "setup", "example.com"),
    false,
  );
});
