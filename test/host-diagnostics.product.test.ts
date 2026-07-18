import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DiagnosticCenter,
  LocalLaunchCapabilities,
  StructuredDiagnosticLog,
} from "../packages/host/src/diagnostics.js";

test("doctor reports typed failures and default support evidence excludes coding content", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-diagnostics-"));
  try {
    const center = new DiagnosticCenter({
      root, maximumBytes: 5_000,
      probes: {
        versions: () => ({ ok: false, cause: "launcher-daemon-mismatch", action: "repair Pidex" }),
        database: () => ({ ok: true }), certificates: () => ({ ok: true }),
        network: () => ({ ok: true }), firewall: () => ({ ok: true }), mdns: () => ({ ok: true }),
        update: () => ({ ok: true }), workers: () => ({ ok: true }), storage: () => ({ ok: true }),
        circuitBreaker: () => ({ ok: true }),
      },
    });
    const report = await center.doctor();
    assert.equal(report.checks[0]?.cause, "launcher-daemon-mismatch");
    assert.equal(report.progress, 1);

    const log = new StructuredDiagnosticLog(root, { maximumBytes: 800 });
    for (let index = 0; index < 30; index++)
      log.write({ area: "worker", cause: "probe-failed", detail: `safe-${index}`, prompt: "FORBIDDEN PROMPT" });
    assert.ok((await readFile(join(root, "diagnostics.jsonl"))).byteLength <= 800);
    await writeFile(join(root, "crash.json"), JSON.stringify({ secret: "FORBIDDEN SECRET", cause: "crash" }));
    const bundle = await center.exportSupport({ includeContent: false });
    const exported = await readFile(bundle.path, "utf8");
    assert.doesNotMatch(exported, /FORBIDDEN|prompt|secret|\/home\//i);
    assert.ok(bundle.bytes <= 5_000);
    assert.equal(center.outboundTransmissions, 0);

    const capabilities = new LocalLaunchCapabilities(() => 100);
    const capability = capabilities.issue("recovery", 10);
    assert.equal(capabilities.consume(capability, "recovery", "127.0.0.1"), true);
    assert.equal(capabilities.consume(capability, "recovery", "127.0.0.1"), false);
    assert.equal(capabilities.consume(capabilities.issue("setup", 10), "setup", "example.com"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
