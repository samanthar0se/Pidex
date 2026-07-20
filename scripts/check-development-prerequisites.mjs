import { spawnSync } from "node:child_process";

const opensslResult = spawnSync("openssl", ["version"], {
  encoding: "utf8",
  windowsHide: true,
});

if (opensslResult.status !== 0) {
  console.error(`OpenSSL prerequisite failure: Pidex development requires OpenSSL on PATH to generate TLS certificates. This is not a Development CA state failure; do not reset a valid CA.

Verify the dependency:
  openssl version

Git for Windows includes OpenSSL. In Command Prompt, expose it for this session:
  set "PATH=C:\\Program Files\\Git\\mingw64\\bin;%PATH%"

Supported CA recovery is explicit: use npm run dev:ca:reset only for unusable CA state, then npm run dev:ca:setup.`);
  process.exitCode = 1;
}
