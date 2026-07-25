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

test("discovery rows separate working, blocked, review, and idle state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/visual-test.html");
  const row = (name: string) => page.locator(`.session-link[aria-label^="${name}"]`);

  await expect(row("Reconnect receipt race")).toHaveAttribute("data-state", "working");
  await expect(row("Reconnect receipt race")).toHaveAttribute("aria-label", "Reconnect receipt race, Working, Unread");
  await expect(row("Reconnect receipt race").locator(".session-detail"))
    .toHaveText("exec_command: command receipts · reconnect continuity");

  await expect(row("Release pipeline review")).toHaveAttribute("data-state", "blocked");
  await expect(row("Release pipeline review").locator(".session-state-label")).toHaveText("Blocked");
  await expect(row("Release pipeline review").locator(".session-detail")).toHaveText("Choose the deployment target");

  await expect(row("Index corruption diagnosis")).toHaveAttribute("data-state", "review");
  await expect(row("Index corruption diagnosis").locator(".session-state-label")).toHaveText("Review");
  await expect(row("Index corruption diagnosis").locator(".session-detail")).toHaveText("Finished 18m ago");

  // Idle is the absence of exceptional state: no rail, no icon, no label.
  await expect(row("PWA cache boundaries")).toHaveAttribute("data-state", "idle");
  await expect(row("PWA cache boundaries").locator(".session-state-label")).toHaveCount(0);
  await expect(row("PWA cache boundaries").locator(".session-state-icon svg")).toHaveCount(0);
  await expect(row("PWA cache boundaries").locator(".session-detail")).toHaveText("1h");
});

// Under a minute the recency token is `now`, which an `ago` suffix would mangle.
test("a review row just finished reads as prose rather than a bare token", async ({ page }) => {
  await page.goto("/visual-test.html");
  const row = page.locator(`.session-link[aria-label^="Index corruption diagnosis"]`);
  await expect(row.locator(".session-detail")).toHaveText("Finished 18m ago");

  await page.evaluate(() => {
    const store = window.__pidexVisualStore!;
    const sessions = store.getState().sessions;
    store.setState({
      sessions: { ...sessions, corruption: { ...sessions.corruption!, activity: { at: Date.now() } } },
    });
  });

  await expect(row.locator(".session-detail")).toHaveText("Finished just now");
});

test("reduced motion keeps the working row identifiable without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/visual-test.html");
  const working = page.locator('.session-link[data-state="working"]');
  await expect(working.locator(".session-state-icon svg")).toHaveCSS("animation-name", "none");
  await expect(working.locator(".session-state-label")).toHaveText("Working");
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
