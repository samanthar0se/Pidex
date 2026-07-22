import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runCli } from "./anonymous-cli.js";

export { PIDEX_COMMANDS, resolveHostUrl, runCli } from "./anonymous-cli.js";

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runCli(process.argv.slice(2), process.env, {
    stdout: value => process.stdout.write(`${value}\n`),
    stderr: value => process.stderr.write(`${value}\n`),
  }).then(code => { process.exitCode = code; });
}
