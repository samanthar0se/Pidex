import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const serviceWorkerGenerationPlaceholder = "__PIDEX_SHELL_GENERATION__";
const clientRoot = fileURLToPath(new URL(".", import.meta.url));

export function renderServiceWorkerGeneration(source: string, entryFile: string): string {
  if (!source.includes(serviceWorkerGenerationPlaceholder)) return source;
  const generation = `pidex-client-${entryFile.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  return source.replace(serviceWorkerGenerationPlaceholder, generation);
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "pidex-service-worker-generation",
      apply: "build",
      async closeBundle() {
        const outputDirectory = join(clientRoot, "dist");
        const manifest = JSON.parse(await readFile(join(outputDirectory, ".vite", "manifest.json"), "utf8")) as Record<string, { file: string; isEntry?: boolean }>;
        const entry = Object.values(manifest).find(item => item.isEntry);
        if (!entry) throw new Error("Client entry missing from Vite manifest");
        const template = await readFile(join(clientRoot, "public", "service-worker.js"), "utf8");
        await writeFile(join(outputDirectory, "service-worker.js"), renderServiceWorkerGeneration(template, entry.file));
      },
    },
  ],
  build: { manifest: true, outDir: "dist", emptyOutDir: true },
});
