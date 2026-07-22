import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README documents explicit profile CA setup and reset", async () => {
  const readme = await readFile("README.md", "utf8");

  assert.match(readme, /npm run dev:ca:setup.*npm run dev/s);
  assert.match(readme, /`created`.*`unchanged`/s);
  assert.match(readme, /fingerprint.*public certificate/is);
  assert.match(readme, /historical checkout-local\s+TLS material/i);
  assert.match(readme, /npm run dev:ca:reset.*npm run dev:ca:setup/s);
});

test("OpenSSL check distinguishes prerequisites from CA recovery", async () => {
  const prerequisite = await readFile(
    "scripts/check-development-prerequisites.mjs",
    "utf8",
  );

  assert.match(prerequisite, /OpenSSL prerequisite/i);
  assert.match(prerequisite, /not a Development CA state failure/i);
  assert.match(prerequisite, /dev:ca:reset.*dev:ca:setup/s);
});
