import assert from "node:assert/strict";
import test from "node:test";
import {
  createProcessPort,
  WindowsPlatformError,
  type NativeProcessBinding,
} from "../packages/windows/src/index.js";

const request = {
  executable: "C:\\Pidex\\node.exe",
  cwd: "C:\\Pidex\\worker",
  argv: ["worker.js", ""],
  environment: { PATH: "C:\\Pidex" },
  bootstrapHandle: 42,
  endpoint: "\\\\.\\pipe\\pidex-worker",
  identity: {
    instanceId: "instance-1",
    releaseId: "release-1",
    protocolGeneration: 1,
    role: "worker" as const,
  },
};

test("the Process port validates contained spawn identity and owns idempotent teardown", async () => {
  let closes = 0;
  const native: NativeProcessBinding = {
    spawnContained: async input => {
      assert.deepEqual(input, request);
      return {
        processId: 123,
        close: async () => { closes += 1; },
      };
    },
  };
  const process = await createProcessPort(native).spawnContained(request);

  assert.equal(process.processId, 123);
  await Promise.all([process.close(), process.close()]);
  assert.equal(closes, 1);
});

test("the Process port rejects relative paths before spawn and maps native failures", async () => {
  let calls = 0;
  const port = createProcessPort({
    spawnContained: async () => {
      calls += 1;
      throw { operation: "CreateProcessW", category: "unavailable", domain: "win32", code: 2, retryable: false, detail: "executable unavailable" };
    },
  });

  await assert.rejects(port.spawnContained({ ...request, executable: "node.exe" }), /absolute/i);
  assert.equal(calls, 0);
  await assert.rejects(port.spawnContained(request), error => {
    assert.ok(error instanceof WindowsPlatformError);
    assert.equal(error.operation, "CreateProcessW");
    return true;
  });
});
