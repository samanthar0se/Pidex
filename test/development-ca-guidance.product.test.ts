import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("development guidance defines setup, shared LAN trust, and the clean break", async () => {
  const [readme, lanGuide, prerequisite] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("docs/development-lan-access.md", "utf8"),
    readFile("scripts/check-development-prerequisites.mjs", "utf8"),
  ]);

  assert.match(readme, /npm run dev:ca:setup[\s\S]*npm run dev/);
  assert.match(readme, /`created`[\s\S]*`unchanged`/);
  assert.match(readme, /fingerprint[\s\S]*public certificate/i);
  assert.match(readme, /historical checkout-local\s+TLS material/i);
  assert.match(readme, /npm run dev:ca:reset[\s\S]*npm run dev:ca:setup/);

  assert.match(lanGuide, /public\s+Development\s+CA certificate/i);
  assert.match(lanGuide, /once/i);
  assert.match(lanGuide, /never (copy|transfer)[\s\S]*private key/i);
  assert.match(lanGuide, /(replacing|renewing) a leaf[\s\S]*do(es)? not require trust/i);
  assert.match(lanGuide, /deleting a checkout[\s\S]*fingerprint/i);
  assert.doesNotMatch(lanGuide, /\.pidex-data-dev\/tls\/pidex-ca\.pem/);

  assert.match(prerequisite, /OpenSSL prerequisite/i);
  assert.match(prerequisite, /not a Development CA state failure/i);
  assert.match(prerequisite, /dev:ca:reset[\s\S]*dev:ca:setup/);
});
