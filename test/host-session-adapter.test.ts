import assert from "node:assert/strict";
import test from "node:test";

test("an in-flight command becomes uncertain when the shared control connection fails", async () => {
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

function settlesPromptly<T>(promise: Promise<T>): Promise<T | "did-not-settle"> {
  return Promise.race([
    promise,
    new Promise<"did-not-settle">(resolve => setTimeout(() => resolve("did-not-settle"), 25)),
  ]);
}
