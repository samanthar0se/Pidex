import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "client.visual.test.ts",
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:4174",
    colorScheme: "light",
  },
  webServer: {
    command: "npx vite apps/client --host 127.0.0.1 --port 4174",
    cwd: "../..",
    url: "http://127.0.0.1:4174/visual-test.html",
    reuseExistingServer: true,
  },
});
