import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ReleaseUpdateError,
  SignedReleaseStore,
} from "../packages/launcher/src/release-update.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("a signed artifact cannot become runnable without its exact nonempty SBOM", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-security-"));
  const source = join(root, "source");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await mkdir(source);
  await writeFile(join(source, "pidex.exe"), "binary");
  await writeFile(join(source, "pidex.cdx.json"), "{}");
  const manifest = {
    releaseId: "security-test",
    protocolGeneration: "1",
    daemonGeneration: "1",
    workerGeneration: "1",
    dataSchema: 1,
    files: [
      { path: "pidex.exe", size: 6, sha256: sha256("binary") },
      { path: "pidex.cdx.json", size: 2, sha256: sha256("{}") },
    ],
    sbom: {
      path: "pidex.cdx.json",
      sha256: sha256("{}"),
      format: "cyclonedx-json-1.5",
    },
  } as const;
  const metadata = Buffer.from(JSON.stringify(manifest));
  try {
    assert.throws(
      () =>
        new SignedReleaseStore(
          root,
          publicKey.export({ type: "spki", format: "pem" }),
        ).stage(source, metadata, sign(null, metadata, privateKey)),
      (error: unknown) =>
        error instanceof ReleaseUpdateError && error.code === "sbom-invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
