import { execFileSync } from "node:child_process";
import { resetDevelopmentCa } from "./development-ca.js";

if (process.platform !== "win32" && !process.env.PIDEX_DEVELOPMENT_PROFILE_ROOT) {
  throw new Error("Development CA reset is a Windows Current User operation");
}

const result = resetDevelopmentCa({
  profileRoot: process.env.PIDEX_DEVELOPMENT_PROFILE_ROOT,
  removeCurrentUserCertificate: fingerprint => {
    execFileSync(
      "certutil",
      ["-user", "-delstore", "Root", fingerprint.replaceAll(":", "")],
      { stdio: "inherit" },
    );
  },
});

console.warn(result.warning);
if (result.removedFingerprint) {
  console.log(`Removed Current User Root: ${result.removedFingerprint}`);
}
if (result.manualCleanup) {
  console.warn(result.manualCleanup);
}
console.log("Next action: npm run dev:ca:setup");
