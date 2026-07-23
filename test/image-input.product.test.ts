import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adaptersFor } from "../packages/adapters/src/index.js";
import {
  isRunSteerMessage,
  isRunSubmitMessage,
} from "../packages/host/src/control-messages.js";
import { AuthorityStore } from "../packages/host/src/store.js";
import type { RunInputImage } from "../packages/protocol/src/input-image.js";

const image: RunInputImage = {
  type: "image",
  data: "aGVsbG8=",
  mimeType: "image/png",
};

test("image-only Run input is validated, durably published, and restored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidex-image-input-"));
  const database = join(dir, "authority.sqlite");
  let store = new AuthorityStore(database, adaptersFor("deterministic"));
  try {
    const session = store.createSession(null, null, 1).session;
    const command = {
      type: "run.submit" as const,
      commandId: "image-submit",
      sessionId: session.sessionId,
      prompt: "",
      images: [image],
      requiredCapability: "run.submit" as const,
    };
    assert.equal(isRunSubmitMessage(command), true);
    const submitted = store.submitRun(command, 2);
    assert.equal(submitted.kind, "accepted");
    if (submitted.kind !== "accepted") throw new Error("run not accepted");
    assert.deepEqual(store.runInputImages(submitted.run.runId), [image]);
    const prompt = store.timeline(session.sessionId).at(-1);
    assert.equal(prompt?.text, "[1 image attached]");
    assert.match(prompt?.blobId ?? "", /^sha256:[a-f0-9]{64}$/);

    store.close();
    store = new AuthorityStore(database, adaptersFor("deterministic"));
    assert.deepEqual(store.runInputImages(submitted.run.runId), [image]);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("image steering accepts image-only input and rejects malformed payloads", () => {
  assert.equal(isRunSteerMessage({
    type: "run.steer",
    requiredCapability: "run.steer",
    commandId: "image-steer",
    sessionId: "session",
    runId: "run",
    workerGeneration: "worker",
    observedTimelineRevision: 1,
    text: "",
    images: [image],
  }), true);
  assert.equal(isRunSubmitMessage({
    type: "run.submit",
    requiredCapability: "run.submit",
    commandId: "bad-image",
    sessionId: "session",
    prompt: "",
    images: [{ ...image, data: "not base64" }],
  }), false);
});
