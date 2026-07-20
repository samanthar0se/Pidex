import { execFileSync } from "node:child_process";
import { setupDevelopmentCa } from "./development-ca.js";

if (process.platform !== "win32" && !process.env.PIDEX_DEVELOPMENT_PROFILE_ROOT) {
  throw new Error("Development CA setup is a Windows Current User operation");
}

const result = setupDevelopmentCa({
  profileRoot: process.env.PIDEX_DEVELOPMENT_PROFILE_ROOT,
  trustCurrentUserCertificate: certificatePath => {
    if (process.platform !== "win32") {
      throw new Error("Current User Root installation is available only on Windows");
    }
    execFileSync("certutil", ["-user", "-addstore", "Root", certificatePath], {
      stdio: "inherit",
    });
  },
});

console.log([
  `Development CA: ${result.status}`,
  `SHA-256 fingerprint: ${result.fingerprint}`,
  `Public certificate: ${result.certificatePath}`,
].join("\n"));
