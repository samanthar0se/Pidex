import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the PWA keeps a bounded non-authoritative per-Host offline working set", async () => {
  const [application, shell] = await Promise.all([
    readFile("apps/pwa/app.js", "utf8"),
    readFile("apps/pwa/index.html", "utf8"),
  ]);

  assert.match(application, /pidex-cache-/);
  assert.match(application, /CACHE_SCHEMA_VERSION/);
  assert.match(application, /"discovery"/);
  assert.match(application, /"session-projections"/);
  assert.match(application, /"finalized-pages"/);
  assert.match(application, /"immutable-blobs"/);
  assert.match(application, /lastSuccessfulSync/);
  assert.match(application, /last observed · incomplete/);
  assert.match(application, /resourceRevisions/);
  assert.match(application, /loadCachedWorkingSet/);
  assert.match(application, /scope\.current/);

  assert.match(shell, /id="last-sync"/);
  assert.match(shell, /Cached data can be incomplete/);
  assert.match(
    shell,
    /sensitive prompts,\s+paths, source, model output, and tool data/,
  );
});
