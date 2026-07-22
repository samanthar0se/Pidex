import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("the canonical build produces the complete reduced unpacked Host", async () => {
  const output = await mkdtemp(join(tmpdir(), "pidex-unpacked-"));
  try {
    await execute(process.execPath, ["scripts/build-unpacked.mjs", output]);

    const files = await listFiles(output);
    assert.deepEqual(files.filter(path => [
      "host.mjs", "pidex.mjs", "client/index.html", "client/service-worker.js",
      "schemas/host-compatibility.v1.json", "native/candidate.json",
      "composition.json", "integrity.json",
    ].includes(path)).sort(), [
      "client/index.html", "client/service-worker.js", "composition.json", "host.mjs",
      "integrity.json", "native/candidate.json", "pidex.mjs",
      "schemas/host-compatibility.v1.json",
    ]);

    const composition = JSON.parse(await readFile(join(output, "composition.json"), "utf8"));
    assert.equal(composition.defaultEndpoint, "http://0.0.0.0:47831");
    assert.deepEqual(composition.commands, ["status", "doctor"]);
    assert.deepEqual(composition.retainedProtections, [
      "launcher-supervision", "singleton", "process-tree-containment",
      "storage-durability", "host-continuity", "release-integrity",
    ]);
    assert.equal(JSON.stringify(composition).match(/tls|certificate|device|token|local.?control|firewall|discovery/i), null);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("the unpacked Host serves the Client and its minimal CLI over configured HTTP", async () => {
  const output = await mkdtemp(join(tmpdir(), "pidex-unpacked-runtime-"));
  const port = 48000 + Math.floor(Math.random() * 1000);
  await execute(process.execPath, ["scripts/build-unpacked.mjs", output]);
  const host = spawn(process.execPath, [join(output, "host.mjs")], {
    cwd: output,
    env: { ...process.env, PIDEX_PORT: String(port), PIDEX_DATA_DIR: join(output, "authority") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
    const shell = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /<div id="root"><\/div>/);

    for (const command of ["status", "doctor"]) {
      const result = await execute(process.execPath, [
        join(output, "pidex.mjs"), command, "--host", `http://127.0.0.1:${port}`, "--json",
      ]);
      assert.doesNotThrow(() => JSON.parse(result.stdout));
    }
  } finally {
    host.kill("SIGTERM");
    await new Promise(resolveExit => host.once("exit", resolveExit));
    await rm(output, { recursive: true, force: true });
  }
});

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, path));
    else result.push(path.replaceAll("\\", "/"));
  }
  return result;
}

async function waitForHttp(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error(`unpacked Host did not become ready at ${url}`);
}
