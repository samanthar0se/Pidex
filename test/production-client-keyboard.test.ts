import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { createClientStore } from "../apps/client/src/client-store.js";

test("FX-KEY-01/02/04 FX-RESP-05: keyboard focus and header Stop retain exact intent", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://pidex.test/" });
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    location: dom.window.location, history: dom.window.history, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; },
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
  })) Object.defineProperty(globalThis, name, { configurable: true, value });
  const { App } = await import("../apps/client/src/App.js");
  const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
  const commands: unknown[] = [];
  const store = createClientStore({
    host: {
      async readSession() { throw new Error("not used"); },
      async stopRun(command) { commands.push(command); return { kind: "accepted" }; },
    },
    drafts: { async read() { return ""; }, async write() {} },
    routing: { replace() {} },
    commandIds: () => "command-header-stop",
  });
  store.setState({
    selectedSessionId: "session-long", isSessionCurrent: true,
    sessions: { "session-long": { sessionId: "session-long", name: "A very long responsive Session title", projectId: "project-one", metadataRevision: 1, timelineRevision: 7 } },
    sessionOrder: ["session-long"], drafts: { "session-long": "" }, timelines: { "session-long": [] },
    runs: { "session-long": [{ runId: "run-exact", sessionId: "session-long", sessionOrder: 1, prompt: "work", state: "executing", workerGeneration: "worker-2" }] },
  });
  render(createElement(App, { clientStore: store } as any));

  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  assert.equal(document.activeElement, screen.getByRole("textbox", { name: "Search Sessions" }));

  const drawer = screen.getByRole("button", { name: "Open Session drawer" });
  fireEvent.click(drawer);
  assert.equal(document.activeElement, screen.getAllByRole("button", { name: "Close Session drawer" })[1]);
  fireEvent.keyDown(screen.getByRole("complementary", { name: "Session drawer" }), { key: "Escape" });
  assert.equal(document.activeElement, drawer);

  fireEvent.click(screen.getByRole("button", { name: "Stop Run run-exact from Session header" }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(commands, [{ commandId: "command-header-stop", sessionId: "session-long", runId: "run-exact", workerGeneration: "worker-2", observedState: "executing", observedTimelineRevision: 7 }]);

  cleanup();
  dom.window.close();
});
