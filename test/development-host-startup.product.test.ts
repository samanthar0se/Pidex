import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const warning = "UNAUTHENTICATED PROTOTYPE: anyone who can reach this Host on the network can view and control Pidex. Do not expose it beyond a trusted LAN.";

test("development startup exposes the HTTP Host with settled Prototype LAN guidance", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-development-host-"));
  const port = await availablePort();
  const child = spawn(process.execPath, ["--import", "tsx", "packages/host/src/development.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PIDEX_DATA_DIR: dataDir, PIDEX_PORT: String(port), PIDEX_HOSTNAME: "discovered-address-must-not-appear" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });

  try {
    await waitFor(
      () => output.includes(`LAN: http://<LAN-IP>:${port}`),
      () => output,
    );
    const lines = output.trim().split(/\r?\n/);
    assert.equal(lines.filter(line => line === warning).length, 1);
    assert.deepEqual(lines.slice(-4), [
      warning,
      `Pidex ready with Pi SDK on 0.0.0.0:${port}`,
      `Loopback: http://localhost:${port}`,
      `LAN: http://<LAN-IP>:${port}`,
    ]);
    assert.equal(output.includes("discovered-address-must-not-appear"), false);
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function waitFor(
  predicate: () => boolean,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`development Host did not become ready:\n${output()}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
