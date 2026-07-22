export type ControlMessageHandler = (message: any, socket: WebSocket) => void;

interface ControlSubscriber {
  onMessage: ControlMessageHandler;
  onUnavailable: () => void;
}

interface ReconnectRuntime {
  online(): boolean;
  random(): number;
  schedule(callback: () => void, delay: number): number;
  cancel(handle: number): void;
}

const browserReconnectRuntime: ReconnectRuntime = {
  online: () => typeof navigator === "undefined" || navigator.onLine,
  random: Math.random,
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: handle => window.clearTimeout(handle),
};
const reconnectDelays = [0, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export class ControlConnection {
  private readonly subscribers = new Set<ControlSubscriber>();
  private readonly statusSubscribers = new Set<(status: "current" | "reconnecting" | "update-required") => void>();
  private socket: WebSocket | undefined;
  private lastHostSnapshot: any;
  private reconnectAttempt = 0;
  private reconnectTimer: number | undefined;

  constructor(
    private readonly createSocket: () => WebSocket,
    private readonly capabilities: readonly string[],
    private readonly runtime: ReconnectRuntime = browserReconnectRuntime,
  ) {}

  subscribe(onMessage: ControlMessageHandler, onUnavailable: () => void = () => {}) {
    const socket = this.open();
    const subscriber = { onMessage, onUnavailable };
    this.subscribers.add(subscriber);
    if (this.lastHostSnapshot) queueMicrotask(() => {
      if (this.subscribers.has(subscriber) && this.socket === socket) subscriber.onMessage(this.lastHostSnapshot, socket);
    });
    return () => {
      this.subscribers.delete(subscriber);
      if (!this.subscribers.size && this.reconnectTimer !== undefined) {
        this.runtime.cancel(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
    };
  }

  subscribeStatus(subscriber: (status: "current" | "reconnecting" | "update-required") => void) {
    this.statusSubscribers.add(subscriber);
    this.open();
    return () => this.statusSubscribers.delete(subscriber);
  }

  reconnectNow(): void {
    if ((!this.subscribers.size && !this.statusSubscribers.size) || !this.runtime.online()) return;
    if (this.reconnectTimer !== undefined) this.runtime.cancel(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.open();
  }

  private open(): WebSocket {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSING && this.socket.readyState !== WebSocket.CLOSED) return this.socket;
    const socket = this.createSocket();
    this.socket = socket;
    this.lastHostSnapshot = undefined;
    let unavailableReported = false;

    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "host.hello") {
        socket.send(JSON.stringify({
          type: "client.hello", expectedHostId: message.hostId,
          protocols: [{ major: 1, minor: 2 }],
          capabilities: this.capabilities.map(id => ({ id, minVersion: 1, maxVersion: 1 })),
        }));
        return;
      }
      if (message.type === "host.snapshot") this.lastHostSnapshot = message;
      this.subscribers.forEach(subscriber => subscriber.onMessage(message, socket));
      if (message.type === "protocol.update-required") {
        this.statusSubscribers.forEach(subscriber => subscriber("update-required"));
      }
      if (message.type === "protocol.admitted") {
        this.statusSubscribers.forEach(subscriber => subscriber("current"));
      }
      if (message.type === "scope.current" || message.type === "scope.reset") {
        this.reconnectAttempt = 0;
        this.statusSubscribers.forEach(subscriber => subscriber("current"));
      }
    };

    const reportUnavailable = () => {
      if (unavailableReported) return;
      unavailableReported = true;
      this.subscribers.forEach(subscriber => subscriber.onUnavailable());
    };
    const disconnected = () => {
      if (this.socket === socket) {
        this.socket = undefined;
        this.lastHostSnapshot = undefined;
      }
      reportUnavailable();
      this.statusSubscribers.forEach(subscriber => subscriber("reconnecting"));
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      disconnected();
      if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) socket.close();
    };
    socket.onclose = disconnected;
    return socket;
  }

  private scheduleReconnect(): void {
    if ((!this.subscribers.size && !this.statusSubscribers.size) || !this.runtime.online() || this.reconnectTimer !== undefined) return;
    const basis = reconnectDelays[Math.min(this.reconnectAttempt, reconnectDelays.length - 1)]!;
    this.reconnectAttempt++;
    const delay = basis === 0 ? 0 : Math.round(basis * (0.75 + this.runtime.random() * 0.5));
    if (delay === 0) return void this.open();
    this.reconnectTimer = this.runtime.schedule(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, delay);
  }
}
