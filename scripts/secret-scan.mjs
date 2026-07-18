import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];
for (const file of files) {
  if (file === "scripts/secret-scan.mjs") continue;
  const bytes = execFileSync("git", ["show", `HEAD:${file}`], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (forbidden.some(pattern => pattern.test(bytes))) {
    console.error(`possible committed secret: ${file}`);
    process.exitCode = 1;
  }
}
