import { adaptersFor } from "../../adapters/src/index.js";
import {
  defaultDevelopmentCaDirectory,
  resetDevelopmentCa,
  setupDevelopmentCa,
} from "./development-certificate.js";

const command = process.argv[2];
const directory =
  process.env.PIDEX_DEVELOPMENT_CA_DIR ?? defaultDevelopmentCaDirectory();
const windows = adaptersFor("product").windows;

switch (command) {
  case "setup": {
    const result = setupDevelopmentCa(directory, windows);
    console.log(
      `${result.status}: ${result.fingerprint}\n` +
        `Public certificate: ${result.certificatePath}`,
    );
    break;
  }
  case "reset": {
    const result = resetDevelopmentCa(directory, windows);
    console.log(`${result.warning}\nTrust cleanup: ${result.cleanup}`);
    break;
  }
  default:
    throw new Error("Expected setup or reset");
}
