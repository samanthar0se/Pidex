import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export { CliControlClient, projectStatus, resolveCliTarget } from "./local-control.js";
export { PIDEX_COMMANDS, runCli } from "./cli-dispatch.js";
export type { CliRuntime } from "./cli-dispatch.js";
export { readStatus } from "./device-status-client.js";

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  throw new Error("CLI packaging must inject the manifest-selected authenticated local-control adapter");
}
