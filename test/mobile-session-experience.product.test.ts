import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const supportedMobileSurfaces = [
  "Android Chrome browser",
  "Android Chrome standalone PWA",
  "iOS Safari browser",
  "iOS Safari standalone PWA",
  "iPadOS Safari browser",
  "iPadOS Safari standalone PWA",
];

for (const surface of supportedMobileSurfaces) {
  test(`${surface} exposes the same routable Session workflow`, async () => {
    const [shell, application] = await Promise.all([
      readFile("apps/pwa/index.html", "utf8"),
      readFile("apps/pwa/app.js", "utf8"),
    ]);

    assert.match(shell, /aria-label="Open Session drawer"/);
    assert.match(shell, /class="drawer-backdrop"/);
    assert.match(shell, /<summary>More<\/summary>/);
    assert.match(shell, /id="mobile-host-state"/);
    assert.match(shell, /@media \(max-width: 720px\)/);
    assert.match(shell, /min-height: 44px/);

    assert.match(application, /function closeDrawer/);
    assert.match(application, /closeDrawer\(\);\s*route\(\)/);
    assert.match(application, /matchMedia\("\(max-width: 720px\)"\)/);
    assert.match(application, /display-mode: standalone/);
    assert.match(application, /mobileHostState\.hidden = state\.current/);

    // View and browser lifecycle events only reconcile projections; they must
    // never issue Session lifecycle or Run control commands.
    const lifecycleHandlers = application.slice(
      application.indexOf('addEventListener("popstate"'),
      application.indexOf('$("#new-session")'),
    );
    assert.doesNotMatch(
      lifecycleHandlers,
      /session\.(archive|restore)|run\.(submit|stop)/,
    );
  });
}
