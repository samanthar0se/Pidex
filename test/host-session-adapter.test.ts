import assert from "node:assert/strict";
import test from "node:test";
import { ControlConnection } from "../apps/client/src/control-connection.js";

test("the shared control connection reconnects with immediate then capped exponential delays", () => {
  const { connection, scheduled, sockets } = createConnectionHarness();

  connection.subscribe(() => {});
  sockets[0]!.close();

  for (const expectedDelay of [0, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    const attempt = scheduled.shift();
    assert.equal(attempt?.delay, expectedDelay);
    attempt?.callback();
    sockets.at(-1)!.close();
  }
});

test("an immediate reconnect yields before opening a replacement socket", () => {
  const { connection, scheduled, sockets } = createConnectionHarness();

  connection.subscribe(() => {});
  sockets[0]!.close();

  assert.equal(sockets.length, 1, "the close handler must not recursively open a socket");
  assert.equal(scheduled[0]?.delay, 0);
  scheduled[0]?.callback();
  assert.equal(sockets.length, 2);
});

test("observing connection status does not open a socket before control work begins", () => {
  const { connection, sockets } = createConnectionHarness();

  connection.subscribeStatus(() => {});
  assert.equal(sockets.length, 0);

  connection.subscribe(() => {});
  assert.equal(sockets.length, 1);
});

test("offline pauses reconnect and online return attempts immediately", () => {
  let online = false;
  const sockets: FakeWebSocket[] = [];
  const connection = new ControlConnection(
    () => {
      const socket = new FakeWebSocket("ws://pidex.test/control");
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }, [], {
      online: () => online,
      random: () => 0.5,
      schedule() { throw new Error("offline reconnect must not be scheduled"); },
      cancel() {},
    },
  );
  connection.subscribe(() => {});
  sockets[0]!.close();
  assert.equal(sockets.length, 1);
  online = true;
  connection.reconnectNow();
  assert.equal(sockets.length, 2);
});

test("an in-flight command becomes uncertain when the shared control connection fails", async () => {
  FakeWebSocket.instances.length = 0;
  const originalLocation = globalThis.location;
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const browserTimers = {
    setTimeout(callback: TimerHandler, delay?: number) {
      return setTimeout(callback, delay) as unknown as number;
    },
    clearTimeout(handle?: number) {
      clearTimeout(handle);
    },
  };

  Object.assign(globalThis, {
    location: { protocol: "http:", host: "pidex.test:7443" },
    WebSocket: FakeWebSocket,
    window: browserTimers,
  });

  try {
    const { hostSessionAdapter } = await import("../apps/client/src/host-session-adapter.js");
    const resultPromise = hostSessionAdapter.createSession!({ commandId: "command-1" });
    const socket = FakeWebSocket.instances[0];
    assert.ok(socket);

    socket.receive({ type: "host.hello", hostId: "host-1" });
    socket.receive({ type: "host.snapshot" });
    socket.fail();

    const result = await settlesPromptly(resultPromise);
    assert.deepEqual(result, { kind: "uncertain", reason: "transport-lost" });

    const closedResultPromise = hostSessionAdapter.createSession!({ commandId: "command-2" });
    const replacementSocket = FakeWebSocket.instances[1];
    assert.ok(replacementSocket);
    replacementSocket.receive({ type: "host.hello", hostId: "host-1" });
    replacementSocket.receive({ type: "host.snapshot" });
    replacementSocket.close();

    const closedResult = await settlesPromptly(closedResultPromise);
    assert.deepEqual(closedResult, { kind: "uncertain", reason: "transport-lost" });
  } finally {
    Object.assign(globalThis, {
      location: originalLocation,
      WebSocket: originalWebSocket,
      window: originalWindow,
    });
  }
});

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  onclose: ((event: CloseEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  readonly sent: string[] = [];

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new Event("close") as CloseEvent);
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  fail() {
    this.onerror?.(new Event("error"));
  }
}

function createConnectionHarness() {
  const sockets: FakeWebSocket[] = [];
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const connection = new ControlConnection(
    () => {
      const socket = new FakeWebSocket("ws://pidex.test/control");
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    [],
    {
      online: () => true,
      random: () => 0.5,
      schedule(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
      cancel() {},
    },
  );
  return { connection, scheduled, sockets };
}

function settlesPromptly<T>(promise: Promise<T>): Promise<T | "did-not-settle"> {
  return Promise.race([
    promise,
    new Promise<"did-not-settle">(resolve => setTimeout(() => resolve("did-not-settle"), 25)),
  ]);
}
