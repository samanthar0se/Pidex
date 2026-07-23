import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { createClientStore } from "../apps/client/src/client-store.js";

test("pasting a clipboard image previews it and submits Pi image content", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://pidex.test/" },
  );
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    history: dom.window.history,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    File: dom.window.File,
    FileReader: dom.window.FileReader,
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
  })) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }

  const commands: unknown[] = [];
  const store = createClientStore({
    host: {
      async readSession() { throw new Error("not used"); },
      async submitRun(command) {
        commands.push(command);
        return { kind: "accepted" };
      },
    },
    drafts: { async read() { return ""; }, async write() {} },
    routing: { replace() {} },
    commandIds: () => "image-paste-command",
  });
  store.setState({
    selectedSessionId: "session-image",
    isSessionCurrent: true,
    sessions: {
      "session-image": {
        sessionId: "session-image",
        name: "Images",
        metadataRevision: 1,
        timelineRevision: 1,
      },
    },
    sessionOrder: ["session-image"],
    timelines: { "session-image": [] },
    runs: { "session-image": [] },
    drafts: { "session-image": "" },
  });

  const { App } = await import("../apps/client/src/App.js");
  const { cleanup, fireEvent, render, screen, waitFor } =
    await import("@testing-library/react");
  render(createElement(App, { clientStore: store } as never));

  const file = new dom.window.File(["hello"], "clipboard.png", {
    type: "image/png",
  });
  const clipboardData = {
    items: [{
      kind: "file",
      type: "image/png",
      getAsFile: () => file,
    }],
  };
  fireEvent.paste(screen.getByRole("textbox", { name: "Composer" }), {
    clipboardData,
  });
  await screen.findByRole("img", { name: "Pasted image 1" });

  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => assert.equal(commands.length, 1));
  assert.deepEqual(commands, [{
    commandId: "image-paste-command",
    sessionId: "session-image",
    prompt: "",
    images: [{
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
    }],
  }]);
  assert.equal(
    screen.queryByRole("img", { name: "Pasted image 1" }),
    null,
  );

  cleanup();
  dom.window.close();
});
