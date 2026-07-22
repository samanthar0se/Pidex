import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] ?? join(root, "build/unpacked"));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await build({
  entryPoints: {
    host: join(root, "packages/host/src/production.ts"),
    pidex: join(root, "packages/cli/src/main.ts"),
  },
  outdir: output,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  sourcemap: false,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

await Promise.all([
  cp(join(root, "apps/client/dist"), join(output, "client"), { recursive: true }),
  cp(join(root, "icon"), join(output, "icon"), { recursive: true }),
  copy("packages/launch-manifest/host-compatibility.v1.json", "schemas/host-compatibility.v1.json"),
  copy("native/windows/candidate.json", "native/candidate.json"),
]);

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const composition = {
  schemaVersion: 1,
  owner: "Pidex Host",
  version: packageJson.version,
  release: `pidex@${packageJson.version}`,
  runtime: { node: ">=22", architecture: "x64" },
  executable: { host: "host.mjs", cli: "pidex.mjs" },
  paths: { client: "client", schemas: "schemas", native: "native", data: "data" },
  defaultEndpoint: "http://0.0.0.0:47831",
  commands: ["status", "doctor"],
  retainedProtections: [
    "launcher-supervision", "singleton", "process-tree-containment",
    "storage-durability", "host-continuity", "release-integrity",
  ],
  integrity: "integrity.json",
};
await writeFile(join(output, "composition.json"), `${JSON.stringify(composition, null, 2)}\n`);

const files = await listFiles(output);
const integrity = {};
for (const file of files.sort()) {
  integrity[file] = createHash("sha256").update(await readFile(join(output, file))).digest("hex");
}
await writeFile(join(output, "integrity.json"), `${JSON.stringify({ algorithm: "sha256", files: integrity }, null, 2)}\n`);

async function copy(source, destination) {
  const target = join(output, destination);
  await mkdir(resolve(target, ".."), { recursive: true });
  await cp(join(root, source), target);
}

async function listFiles(directory, relative = "") {
  const files = [];
  for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, path));
    else files.push(path.replaceAll("\\", "/"));
  }
  return files;
}
