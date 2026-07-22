import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("the anonymous-runtime checker rejects a removed product module", () => {
  const root = fixtureRoot();
  mkdirSync(join(root, "packages/host/src"), { recursive: true });
  writeFileSync(join(root, "packages/host/src/pairing.ts"), "export const pairing = true;\n");

  assert.throws(
    () => execFileSync(process.execPath, ["scripts/check-anonymous-runtime.mjs", root], {
      encoding: "utf8",
      stdio: "pipe",
    }),
    error => {
      assert.match(String((error as { stderr?: string }).stderr), /forbidden module.*pairing\.ts/i);
      return true;
    },
  );
});

test("the checker scans generated output and rejects disabled obsolete-security tests", () => {
  const generated = fixtureRoot();
  mkdirSync(join(generated, "apps/client/dist"), { recursive: true });
  writeFileSync(join(generated, "apps/client/dist/client.js"), `fetch('/pair/${"chall" + "enge"}');\n`);
  assert.throws(() => check(generated), /command failed/i);

  const skipped = fixtureRoot();
  mkdirSync(join(skipped, "test"));
  writeFileSync(join(skipped, "test/security.test.ts"), `${"test" + ".skip"}('pairing works', () => {});\n`);
  assert.throws(() => check(skipped), /command failed/i);
});

test("the checker permits only inventoried retained-protection contexts", () => {
  const root = fixtureRoot();
  mkdirSync(join(root, "packages/host/src"), { recursive: true });
  writeFileSync(join(root, "packages/host/src/portable-backup.ts"), "throw Error('backup-authentication-failed');\n");
  assert.doesNotThrow(() => check(root));
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pidex-boundary-"));
  mkdirSync(join(root, "config"));
  cpSync("config/anonymous-runtime-boundary.json", join(root, "config/anonymous-runtime-boundary.json"));
  return root;
}

function check(root: string): string {
  return execFileSync(process.execPath, ["scripts/check-anonymous-runtime.mjs", root], {
    encoding: "utf8",
    stdio: "pipe",
  });
}
