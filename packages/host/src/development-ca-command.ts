import { adaptersFor } from "../../adapters/src/index.js";
import { defaultDevelopmentCaDirectory, resetDevelopmentCa, setupDevelopmentCa } from "./development-certificate.js";

const command = process.argv[2];
const directory = process.env.PIDEX_DEVELOPMENT_CA_DIR ?? defaultDevelopmentCaDirectory();
const windows = adaptersFor("product").windows;
if (command === "setup") {
  const result = setupDevelopmentCa(directory, windows);
  console.log(`${result.status}: ${result.fingerprint}\nPublic certificate: ${result.certificatePath}`);
} else if (command === "reset") {
  const result = resetDevelopmentCa(directory, windows);
  console.log(`${result.warning}\nTrust cleanup: ${result.cleanup}`);
} else {
  throw new Error("Expected setup or reset");
}
