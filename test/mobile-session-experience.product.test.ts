import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("supported mobile browsers and standalone PWAs expose the routable Session workflow", async () => {
  const [shell, application, manifest] = await Promise.all([
    readFile("apps/pwa/index.html", "utf8"),
    readFile("apps/pwa/app.js", "utf8"),
    readFile("apps/pwa/manifest.webmanifest", "utf8"),
  ]);

  assert.match(shell, /aria-label="Open Session drawer"/);
  assert.match(shell, /class="drawer-backdrop"/);
  assert.match(shell, /<summary>More<\/summary>/);
  assert.match(shell, /id="mobile-host-state"/);
  assert.match(shell, /@media \(max-width: 720px\)/);
  assert.match(shell, /min-height: 44px/);
  assert.match(manifest, /"display":\s*"standalone"/);

  assert.match(application, /function closeDrawer/);
  assert.match(application, /closeDrawer\(\);\s*route\(\)/);
  assert.match(application, /matchMedia\("\(max-width: 720px\)"\)/);
  assert.match(application, /mobileHostState\.hidden = state\.current/);

  const lifecycleStart = application.indexOf('addEventListener("popstate"');
  const lifecycleEnd = application.indexOf('$("#new-session")');
  assert.notEqual(lifecycleStart, -1);
  assert.notEqual(lifecycleEnd, -1);

  // View and browser lifecycle events only reconcile projections; they must
  // never issue Session lifecycle or Run control commands.
  const lifecycleHandlers = application.slice(lifecycleStart, lifecycleEnd);
  assert.doesNotMatch(
    lifecycleHandlers,
    /session\.(archive|restore)|run\.(submit|stop)/,
  );
});
