import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { startHost } from "../packages/host/src/host.js";
import { clientHello, protocolVersion, serverMessageSchema } from "../packages/protocol/src/status.js";

function read(origin: string, host: string): Promise<{ status: number; headers: NodeJS.Dict<string | string[]> }> {
  return new Promise((resolve, reject) => {
    const call = request(new URL("/api/missing", origin), {
      headers: { host, origin: "https://arbitrary-browser.invalid" },
    }, response => {
      response.resume();
      resolve({ status: response.statusCode ?? 0, headers: response.headers });
    });
    call.on("error", reject);
    call.end();
  });
}

test("reachable Anonymous Clients control the plain HTTP Host without authorization material", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pidex-anonymous-host-"));
  const host = await startHost({ dataDir, port: 0, adapters: adaptersFor("deterministic") });
  try {
    assert.match(host.origin, /^http:\/\//);
    const response = await read(host.origin, "anything.example:1234");
    assert.equal(response.status, 404);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers.location, undefined);

    const socket = new WebSocket(`${host.origin.replace(/^http:/, "ws:")}/control`, {
      headers: { origin: "https://arbitrary-browser.invalid" },
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("message", bytes => {
        const message = serverMessageSchema.parse(JSON.parse(bytes.toString()));
        if (message.type === "host.hello") socket.send(JSON.stringify(clientHello(message.hostId)));
        if (message.type === "host.snapshot") socket.send(JSON.stringify({
          type: "scope.set", protocolVersion, sessionIds: [], cursor: message.status.synchronization.cursor,
        }));
        if (message.type === "scope.current") socket.send(JSON.stringify({
          type: "session.create", commandId: "anonymous-create",
        }));
        if (message.type === "command.outcome") {
          assert.equal(message.outcome, "accepted");
        }
        if (message.type === "host.change-set") resolve();
      });
      socket.once("error", reject);
    });
    socket.close();
  } finally {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
