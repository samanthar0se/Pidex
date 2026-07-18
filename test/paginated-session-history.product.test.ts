import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import {
  protocolVersion,
  timelineWindowSchema,
} from "../packages/protocol/src/status.js";
import { negotiateControl, nextControlMessage } from "./control-client.js";

interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function getHostResource(
  origin: string,
  path: string,
  token?: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const pendingRequest = request(
      `${origin}${path}`,
      { rejectUnauthorized: false, headers },
      response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode === undefined) {
            reject(new Error("HTTP response did not include a status code"));
            return;
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    pendingRequest.on("error", reject).end();
  });
}

test("returns bounded Session windows, pages stable finalized history, and verifies blobs", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-pages-"));
  const adapters = adaptersFor("deterministic");
  adapters.pi.execute = async ({ prompt }) => ({
    text: `answer:${prompt}`,
    checkpoint: `cp:${prompt}`,
  });
  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "device",
    adapters,
  });
  try {
    const socket = new WebSocket(
      `${host.origin.replace("https:", "wss:")}/control`,
      {
        rejectUnauthorized: false,
        headers: { authorization: "Bearer device" },
      },
    );
    await negotiateControl(socket);
    socket.send(JSON.stringify({ type: "session.create", commandId: "create" }));
    await nextControlMessage(socket);
    const created = await nextControlMessage(socket);
    assert.equal(created.type, "host.change-set");
    if (created.type !== "host.change-set") return;
    const [sessionChange] = created.changes;
    assert.ok(sessionChange);
    const sessionId = sessionChange.session.sessionId;
    socket.send(
      JSON.stringify({
        type: "scope.set",
        sessionIds: [sessionId],
        protocolVersion,
      }),
    );
    while ((await nextControlMessage(socket)).type !== "scope.reset") {
      // The Host reset may precede the Session reset.
    }

    for (let index = 0; index < 55; index++) {
      socket.send(
        JSON.stringify({
          type: "run.submit",
          commandId: `run-${index}`,
          sessionId,
          prompt: `${index}`,
          requiredCapability: "run.submit",
        }),
      );
      while ((await nextControlMessage(socket)).type !== "run.completed") {
        // Drain live Timeline changes.
      }
    }
    socket.send(
      JSON.stringify({
        type: "scope.set",
        sessionIds: [sessionId],
        protocolVersion,
      }),
    );
    let reset;
    do {
      reset = await nextControlMessage(socket);
    } while (
      reset.type !== "scope.reset" ||
      reset.barrier.scope.kind !== "session"
    );
    assert.ok("timelineWindow" in reset.snapshot);
    if (!("timelineWindow" in reset.snapshot)) return;
    assert.ok(reset.snapshot.timelineWindow);
    const window = reset.snapshot.timelineWindow;
    assert.equal(window.entries.length, 100);
    const olderCursor = window.olderCursor;
    assert.ok(olderCursor);

    // Append after taking the cursor: the older page remains anchored and cannot duplicate it.
    socket.send(
      JSON.stringify({
        type: "run.submit",
        commandId: "concurrent",
        sessionId,
        prompt: "later",
        requiredCapability: "run.submit",
      }),
    );
    while ((await nextControlMessage(socket)).type !== "run.completed") {
      // Drain live Timeline changes.
    }
    const pageResponse = await getHostResource(
      host.origin,
      `/api/sessions/${sessionId}/timeline?cursor=${encodeURIComponent(olderCursor)}&limit=20`,
      "device",
    );
    assert.equal(pageResponse.status, 200);
    assert.equal(pageResponse.headers["cache-control"], "no-store");
    const page = timelineWindowSchema.parse(
      JSON.parse(pageResponse.body.toString()),
    );
    assert.equal(page.entries.length, 10);
    const reconstructed = [...page.entries, ...window.entries];
    assert.equal(reconstructed.length, 110);
    assert.equal(new Set(reconstructed.map(entry => entry.entryId)).size, 110);
    assert.deepEqual(
      reconstructed.map(entry => entry.order),
      Array.from({ length: 110 }, (_, index) => index + 1),
    );

    const unauthorizedPage = await getHostResource(
      host.origin,
      `/api/sessions/${sessionId}/timeline?cursor=x`,
    );
    assert.equal(unauthorizedPage.status, 401);
    const blobId = reconstructed.find(entry => entry.blobId)?.blobId;
    assert.ok(blobId);
    const blob = await getHostResource(
      host.origin,
      `/api/blobs/${blobId}`,
      "device",
    );
    assert.equal(blob.status, 200);
    assert.equal(blob.headers["x-content-id"], blobId);
    assert.match(String(blob.headers.digest), /^sha-256=/);
    await writeFile(join(dataDir, "blobs", blobId.slice(7)), "corrupt");
    const corruptBlob = await getHostResource(
      host.origin,
      `/api/blobs/${blobId}`,
      "device",
    );
    assert.equal(corruptBlob.status, 500);

    host.rotateSynchronizationEpoch();
    const expiredPage = await getHostResource(
      host.origin,
      `/api/sessions/${sessionId}/timeline?cursor=${encodeURIComponent(olderCursor)}`,
      "device",
    );
    assert.equal(expiredPage.status, 409);
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
