import { spawnSync } from "node:child_process";

const opensslResult = spawnSync("openssl", ["version"], {
  encoding: "utf8",
  windowsHide: true,
});

if (opensslResult.status !== 0) {
  console.error(`Pidex development requires OpenSSL on PATH to generate TLS certificates.

Verify the dependency:
  openssl version

Git for Windows includes OpenSSL. In Command Prompt, expose it for this session:
  set "PATH=C:\\Program Files\\Git\\mingw64\\bin;%PATH%"`);
  process.exitCode = 1;
}
