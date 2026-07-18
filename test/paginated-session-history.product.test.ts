import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { protocolVersion } from "../packages/protocol/src/status.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

function get(origin: string, path: string, token?: string): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(`${origin}${path}`, { rejectUnauthorized: false, headers: token ? { authorization: `Bearer ${token}` } : {} }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject).end();
  });
}

test("bounded Session windows page stable finalized history and verify blobs", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-pages-"));
  const adapters = adaptersFor("deterministic");
  adapters.pi.execute = async ({ prompt }) => ({ text: `answer:${prompt}`, checkpoint: `cp:${prompt}` });
  const host = await startHost({ dataDir, port: 0, authorization: "device", adapters });
  try {
    const socket = new WebSocket(`${host.origin.replace("https:", "wss:")}/control`, { rejectUnauthorized: false, headers: { authorization: "Bearer device" } });
    await negotiateControl(socket);
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") return;
    const sessionId = created.changes[0]!.session.sessionId;
    socket.send(JSON.stringify({ type: "scope.set", sessionIds: [sessionId], protocolVersion }));
    while ((await nextControlMessage(socket)).type !== "scope.reset") { /* host reset may precede Session reset */ }

    for (let index = 0; index < 55; index++) {
      socket.send(JSON.stringify({ type: "run.submit", commandId: `run-${index}`, sessionId, prompt: `${index}`, requiredCapability: "run.submit" }));
      while ((await nextControlMessage(socket)).type !== "run.completed") { /* drain live facts */ }
    }
    socket.send(JSON.stringify({ type: "scope.set", sessionIds: [sessionId], protocolVersion }));
    let reset;
    do reset = await nextControlMessage(socket); while (reset.type !== "scope.reset" || reset.barrier.scope.kind !== "session");
    assert.ok(reset.snapshot && "timelineWindow" in reset.snapshot);
    if (!("timelineWindow" in reset.snapshot) || !reset.snapshot.timelineWindow) return;
    const window = reset.snapshot.timelineWindow;
    assert.equal(window.entries.length, 100);
    assert.ok(window.olderCursor);

    // Append after taking the cursor: the older page remains anchored and cannot duplicate it.
    socket.send(JSON.stringify({ type: "run.submit", commandId: "concurrent", sessionId, prompt: "later", requiredCapability: "run.submit" }));
    while ((await nextControlMessage(socket)).type !== "run.completed") { /* drain */ }
    const pageResponse = await get(host.origin, `/api/sessions/${sessionId}/timeline?cursor=${encodeURIComponent(window.olderCursor!)}&limit=20`, "device");
    assert.equal(pageResponse.status, 200);
    assert.equal(pageResponse.headers["cache-control"], "no-store");
    const page = JSON.parse(pageResponse.body.toString()) as typeof window;
    assert.equal(page.entries.length, 10);
    const reconstructed = [...page.entries, ...window.entries];
    assert.equal(reconstructed.length, 110);
    assert.equal(new Set(reconstructed.map(entry => entry.entryId)).size, 110);
    assert.deepEqual(reconstructed.map(entry => entry.order), Array.from({ length: 110 }, (_, i) => i + 1));

    assert.equal((await get(host.origin, `/api/sessions/${sessionId}/timeline?cursor=x`)).status, 401);
    const blobId = reconstructed.find(entry => entry.blobId)?.blobId;
    assert.ok(blobId);
    const blob = await get(host.origin, `/api/blobs/${blobId}`, "device");
    assert.equal(blob.status, 200);
    assert.equal(blob.headers["x-content-id"], blobId);
    assert.match(String(blob.headers.digest), /^sha-256=/);
    await writeFile(join(dataDir, "blobs", blobId!.slice(7)), "corrupt");
    assert.equal((await get(host.origin, `/api/blobs/${blobId}`, "device")).status, 500);

    host.rotateSynchronizationEpoch();
    assert.equal((await get(host.origin, `/api/sessions/${sessionId}/timeline?cursor=${encodeURIComponent(window.olderCursor!)}`, "device")).status, 409);
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
