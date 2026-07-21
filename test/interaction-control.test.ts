import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { InteractionControl } from "../apps/client/src/InteractionControl.js";
import type { InteractionFact, InteractionResolution } from "../apps/client/src/client-store.js";

test("an answer is cleared when projection changes replace the displayed Interaction", async () => {
  const dom = installDom();
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const resolutions: Array<{ interactionId: string; resolution: InteractionResolution }> = [];
  const props = {
    position: 1,
    count: 2,
    onWriteMessage() {},
    onNext() {},
    onResolve(interactionId: string, resolution: InteractionResolution) {
      resolutions.push({ interactionId, resolution });
    },
  };
  const first = interaction("first", "editor");
  const second = interaction("second", "input");
  const view = render(createElement(InteractionControl, { ...props, interaction: first }));

  fireEvent.change(view.getByLabelText("Interaction response"), { target: { value: "first secret" } });
  view.rerender(createElement(InteractionControl, { ...props, interaction: second }));

  const secondInput = view.getByLabelText("Interaction response") as HTMLInputElement;
  const respond = view.getByRole("button", { name: "Respond" }) as HTMLButtonElement;
  assert.equal(secondInput.value, "");
  assert.equal(respond.disabled, true);

  fireEvent.change(secondInput, { target: { value: "second answer" } });
  fireEvent.click(respond);
  assert.deepEqual(resolutions, [{
    interactionId: "second",
    resolution: { kind: "respond", value: "second answer" },
  }]);

  cleanup();
  dom.window.close();
});

test("a resolving Interaction reports its state without offering active resolution controls", async () => {
  const dom = installDom();
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const resolutions: InteractionResolution[] = [];
  const view = render(createElement(InteractionControl, {
    interaction: { ...interaction("resolving", "input"), state: "resolving" },
    position: 1,
    count: 1,
    onWriteMessage() {},
    onNext() {},
    onResolve(_interactionId: string, resolution: InteractionResolution) {
      resolutions.push(resolution);
    },
  }));

  fireEvent.change(view.getByLabelText("Interaction response"), { target: { value: "too late" } });
  const dismiss = view.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement;
  const respond = view.getByRole("button", { name: "Respond" }) as HTMLButtonElement;
  assert.equal(dismiss.disabled, true);
  assert.equal(respond.disabled, true);
  assert.equal(view.getByRole("status").textContent, "resolving");
  fireEvent.click(dismiss);
  fireEvent.click(respond);
  assert.deepEqual(resolutions, []);

  cleanup();
  dom.window.close();
});

function interaction(
  interactionId: string,
  kind: "input" | "editor",
): InteractionFact {
  return {
    interactionId,
    sessionId: "session-one",
    runId: "run-one",
    workerGeneration: 3,
    correlationId: `correlation-${interactionId}`,
    kind,
    payload: { message: interactionId },
    state: "open",
    revision: 1,
    createdAt: 1,
    deadlineAt: null,
    terminalCause: null,
    respondedAt: null,
    respondingDeviceLabel: null,
    applicationProven: null,
  };
}

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://pidex.test" });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
  })) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  return dom;
}
