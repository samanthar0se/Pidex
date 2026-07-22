import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../packages/cli/src/anonymous-cli.js";

test("an ordinary connection failure whose host name mentions protocol uses the control-failure exit", async () => {
  const errors: string[] = [];

  const exitCode = await runCli(
    ["status", "--host", "http://protocol.invalid"],
    {},
    {
      stdout: () => undefined,
      stderr: error => errors.push(error),
    },
  );

  assert.equal(exitCode, 2);
  assert.match(errors[0] ?? "", /ENOTFOUND protocol\.invalid/);
});
