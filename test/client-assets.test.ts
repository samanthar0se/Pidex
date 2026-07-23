import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClientAssetResolver } from "../packages/host/src/client-assets.js";

test("a running Client asset resolver follows a newly generated Vite entry", async () => {
  const clientDist = await mkdtemp(join(tmpdir(), "pidex-client-assets-"));
  try {
    await mkdir(join(clientDist, ".vite"));
    await writeManifest(clientDist, "old");
    const resolveAsset = createClientAssetResolver(clientDist);
    assert.match(resolveAsset("GET", "/assets/index-old.js")?.file ?? "", /index-old\.js$/);

    await writeFile(join(clientDist, ".vite", "manifest.json"), "incomplete build");
    assert.match(resolveAsset("GET", "/assets/index-old.js")?.file ?? "", /index-old\.js$/);

    await writeManifest(clientDist, "new");
    assert.equal(resolveAsset("GET", "/assets/index-old.js"), undefined);
    assert.match(resolveAsset("GET", "/assets/index-new.js")?.file ?? "", /index-new\.js$/);
  } finally {
    await rm(clientDist, { recursive: true, force: true });
  }
});

async function writeManifest(clientDist: string, version: string): Promise<void> {
  await writeFile(join(clientDist, ".vite", "manifest.json"), JSON.stringify({
    "index.html": {
      file: `assets/index-${version}.js`,
      css: [`assets/index-${version}.css`],
    },
  }));
}
