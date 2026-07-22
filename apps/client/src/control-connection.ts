export type ControlMessageHandler = (message: any, socket: WebSocket) => void;

interface ControlSubscriber {
  onMessage: ControlMessageHandler;
  onUnavailable: () => void;
}

export class ControlConnection {
  private readonly subscribers = new Set<ControlSubscriber>();
  private socket: WebSocket | undefined;
  private lastHostSnapshot: any;

  constructor(
    private readonly createSocket: () => WebSocket,
    private readonly capabilities: readonly string[],
  ) {}

  subscribe(onMessage: ControlMessageHandler, onUnavailable: () => void = () => {}) {
    const socket = this.open();
    const subscriber = { onMessage, onUnavailable };
    this.subscribers.add(subscriber);
    if (this.lastHostSnapshot) {
      queueMicrotask(() => {
        if (this.subscribers.has(subscriber) && this.socket === socket) {
          subscriber.onMessage(this.lastHostSnapshot, socket);
        }
      });
    }
    return () => this.subscribers.delete(subscriber);
  }

  private open(): WebSocket {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSING && this.socket.readyState !== WebSocket.CLOSED) {
      return this.socket;
    }

    const socket = this.createSocket();
    this.socket = socket;
    this.lastHostSnapshot = undefined;
    let unavailableReported = false;

    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "host.hello") {
        socket.send(JSON.stringify({
          type: "client.hello",
          expectedHostId: message.hostId,
          protocols: [{ major: 1, minor: 2 }],
          capabilities: this.capabilities.map(id => ({ id, minVersion: 1, maxVersion: 1 })),
        }));
        return;
      }
      if (message.type === "host.snapshot") this.lastHostSnapshot = message;
      this.subscribers.forEach(subscriber => subscriber.onMessage(message, socket));
    };

    const reportUnavailable = () => {
      if (unavailableReported) return;
      unavailableReported = true;
      this.subscribers.forEach(subscriber => subscriber.onUnavailable());
    };
    socket.onerror = () => {
      if (this.socket === socket) {
        this.socket = undefined;
        this.lastHostSnapshot = undefined;
      }
      reportUnavailable();
      if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) socket.close();
    };
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = undefined;
        this.lastHostSnapshot = undefined;
      }
      reportUnavailable();
    };
    return socket;
  }
}
