import { expect, test } from "@playwright/test";

test("desktop workbench retains the accepted quiet shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/visual-test.html");
  await expect(page.locator(".timeline-turn")).toHaveCount(2);
  await expect(page.locator(".timeline-turn[data-phase=complete] .work-trigger")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".timeline-turn[data-phase=working] .work-trigger")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".activity-row")).toHaveCount(5);
  await expect(page.locator(".shell")).toHaveScreenshot("desktop-workbench.png", { animations: "disabled" });
});

test("desktop New Session maps scope and prompt onto the Codex home composition", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/visual-test.html?scenario=new-session");
  await expect(page.locator(".shell")).toHaveScreenshot("desktop-new-session.png", { animations: "disabled" });
});

test("mobile Interaction retains the bounded control dock", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto("/visual-test.html?scenario=interaction");
  await expect(page.locator(".shell")).toHaveScreenshot("mobile-interaction.png", { animations: "disabled" });
});

test("activity stays collapsed by default unless manual disclosure control took over", async ({ page }) => {
  await page.goto("/visual-test.html");
  const activeTurn = page.locator(".timeline-turn[data-run-id='run-18']");
  const trigger = activeTurn.locator(".work-trigger");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await appendToolActivity(page);
  await expect(activeTurn.locator("[data-entry-id='tool-next-18']")).toHaveCount(1);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(activeTurn.locator(".work-live-preview")).toHaveText("Executing a command…");
  await expect(activeTurn.locator(".work-live-preview")).not.toContainText("FULL_RAW_TOOL_OUTPUT");

  await appendStreamingResponse(page);
  await expect(activeTurn).toHaveAttribute("data-phase", "responding");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(activeTurn.locator(".work-live-preview")).toHaveCount(0);
  const response = activeTurn.locator("[data-entry-id='response-18']");
  await expect(response).toBeVisible();
  const streamingNode = await response.elementHandle();
  if (!streamingNode) throw new Error("streaming response node unavailable");
  await finalizeResponse(page);
  await expect(activeTurn).toHaveAttribute("data-phase", "complete");
  await expect(response).toHaveAttribute("data-finalized", "true");
  await expect(response.locator(".response-actions")).toHaveAttribute("data-available", "true");
  expect(await response.evaluate((node, original) => node === original, streamingNode)).toBe(true);
  await response.getByRole("button", { name: "Copy response" }).click();
  await expect(response.getByRole("button", { name: "Response copied" })).toBeVisible();

  await page.reload();
  const manuallyControlledTurn = page.locator(".timeline-turn[data-run-id='run-18']");
  const manualTrigger = manuallyControlledTurn.locator(".work-trigger");
  await manualTrigger.click();
  await expect(manuallyControlledTurn.locator(".work-live-preview")).toHaveCount(0);
  await appendStreamingResponse(page);
  await expect(manuallyControlledTurn).toHaveAttribute("data-phase", "responding");
  await expect(manualTrigger).toHaveAttribute("aria-expanded", "true");
});

test("tool rows keep raw output collapsed until their own disclosure opens", async ({ page }) => {
  await page.goto("/visual-test.html");
  const activeTurn = page.locator(".timeline-turn[data-run-id='run-18']");
  await appendToolActivity(page);
  await activeTurn.locator(".work-trigger").click();

  const toolRow = activeTurn.locator("[data-entry-id='tool-next-18']");
  const toolTrigger = toolRow.getByRole("button", { name: "Show raw output for exec" });
  await expect(toolTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(toolRow.locator(".activity-detail")).toHaveCount(0);

  await toolTrigger.click();
  await expect(toolRow.getByRole("button", { name: "Hide raw output for exec" })).toHaveAttribute("aria-expanded", "true");
  await expect(toolRow.locator(".activity-detail")).toHaveText("FULL_RAW_TOOL_OUTPUT\nsecond raw output line");

  await toolRow.getByRole("button", { name: "Hide raw output for exec" }).click();
  await expect(toolRow.locator(".activity-detail")).toHaveCount(0);
});

test("reduced motion keeps disclosure state while removing transition motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/visual-test.html");
  const trigger = page.locator(".timeline-turn[data-run-id='run-18'] .work-trigger");
  const panel = page.locator(".timeline-turn[data-run-id='run-18'] .work-panel");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toHaveCSS("transition-duration", "0s");
});

async function appendToolActivity(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const store = window.__pidexVisualStore;
    if (!store) throw new Error("visual store unavailable");
    const state = store.getState();
    const current = state.timelines.reconnect ?? [];
    store.setState({
      timelines: {
        ...state.timelines,
        reconnect: [...current, {
          entryId: "tool-next-18",
          kind: "tool",
          runId: "run-18",
          order: 9,
          revision: 1,
          finalized: true,
          text: "exec: FULL_RAW_TOOL_OUTPUT\nsecond raw output line",
        }],
      },
    });
  });
}

async function appendStreamingResponse(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const store = window.__pidexVisualStore;
    if (!store) throw new Error("visual store unavailable");
    const state = store.getState();
    const current = state.timelines.reconnect ?? [];
    store.setState({
      timelines: {
        ...state.timelines,
        reconnect: [...current, {
          entryId: "response-18",
          kind: "response",
          runId: "run-18",
          order: 10,
          revision: 1,
          finalized: false,
          text: "The focused receipt checks are still running, and the first verified result is now available.",
        }],
      },
    });
  });
}

async function finalizeResponse(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const store = window.__pidexVisualStore;
    if (!store) throw new Error("visual store unavailable");
    const state = store.getState();
    store.setState({
      timelines: {
        ...state.timelines,
        reconnect: (state.timelines.reconnect ?? []).map(entry => entry.entryId === "response-18"
          ? { ...entry, revision: 2, finalized: true, text: `${entry.text} All focused checks passed.` }
          : entry),
      },
      runs: {
        ...state.runs,
        reconnect: (state.runs.reconnect ?? []).map(run => run.runId === "run-18"
          ? { ...run, state: "completed" }
          : run),
      },
    });
  });
}
