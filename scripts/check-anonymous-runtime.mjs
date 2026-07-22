import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
const inventoryPath = resolve(process.argv[3] ?? join(root, "config/anonymous-runtime-boundary.json"));
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const violations = [];

for (const exception of inventory.exceptions) {
  if (!inventory.allowedExceptionClasses.includes(exception.class)) {
    violations.push(`invalid exception class: ${exception.class ?? "missing"}`);
  }
}

for (const item of inventory.forbiddenPaths) {
  if (existsSync(join(root, item.path))) violations.push(`forbidden ${item.category}: ${item.path}`);
}

const files = [];
for (const scanRoot of inventory.scanRoots) {
  const absolute = join(root, scanRoot);
  if (existsSync(absolute)) await collect(absolute, files);
}

for (const file of files) {
  const path = relative(root, file).replaceAll("\\", "/");
  const content = await readFile(file, "utf8").catch(() => undefined);
  if (content === undefined) continue;
  for (const rule of inventory.forbiddenContent) {
    if (rule.paths?.length && !rule.paths.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) continue;
    const pattern = new RegExp(rule.pattern, rule.flags ?? "");
    if (!pattern.test(content)) continue;
    const excepted = inventory.exceptions.some(exception =>
      exception.rule === rule.id &&
      (path === exception.path || path.startsWith(`${exception.path}/`)) &&
      (!exception.pattern || new RegExp(exception.pattern, exception.flags ?? "").test(content))
    );
    if (!excepted) violations.push(`forbidden ${rule.category}: ${path} (${rule.id})`);
  }
}

if (violations.length) {
  console.error(`Anonymous-runtime boundary failed:\n${violations.map(item => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Anonymous-runtime boundary passed (${files.length} files checked).`);
}

async function collect(path, output) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  if (!entries.length) {
    output.push(path);
    return;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await collect(child, output);
    else if (entry.isFile()) output.push(child);
  }
}
