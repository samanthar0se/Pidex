import { createHash } from "node:crypto";
import type { CliControlClient } from "./cli-control-client.js";

/** Operations exposed by the signed CLI entry point. */
export const PIDEX_COMMANDS = Object.freeze([
  "status",
  "start",
  "retry",
  "stop",
  "restart",
  "pairing",
  "revoke",
  "origin",
  "certificate",
  "firewall",
  "update",
  "logs",
  "backup",
  "restore",
  "recovery",
  "doctor",
  "support",
  "operation",
  "unprepare",
  "purge",
] as const);

const commandOwners = Object.freeze({
  start: "launcher", retry: "launcher", stop: "launcher", restart: "launcher",
  pairing: "daemon", revoke: "daemon", origin: "daemon", certificate: "daemon",
  firewall: "daemon", logs: "launcher", doctor: "launcher", support: "launcher",
  backup: "daemon", restore: "maintenance", recovery: "maintenance",
  unprepare: "source-driver", purge: "launcher",
} as const);

export interface CliRuntime {
  client: CliControlClient;
  stdout(value: string): void;
  stderr?(value: string): void;
}

/** Command projection shared by the TypeScript entry point and emitted main.js. */
export async function runCli(argv: readonly string[], runtime: CliRuntime): Promise<number> {
  const json = argv.includes("--json");
  const detach = argv.includes("--detach");
  const positional = argv.filter(argument => !argument.startsWith("--"));
  const command = positional[0];
  if (!command || !PIDEX_COMMANDS.some(candidate => candidate === command)) {
    throw new Error(`Usage: pidex <${PIDEX_COMMANDS.join("|")}>`);
  }

  if (command === "status") {
    const status = await runtime.client.status();
    runtime.stdout(json ? JSON.stringify(status.json) : status.human);
    return ({ healthy: 0, degraded: 1, unavailable: 2, incompatible: 3, "control-failure": 4 } as const)[status.exit];
  }
  if (command === "operation") {
    const action = positional[1];
    const operationId = positional[2];
    if (!operationId || (action !== "status" && action !== "follow" && action !== "cancel")) {
      throw new Error("Usage: pidex operation <status|follow|cancel> <operation-id> [phase]");
    }
    const result = action === "cancel"
      ? await runtime.client.cancel(operationId, positional[3] ?? "queued")
      : await runtime.client.follow(operationId);
    runtime.stdout(JSON.stringify(result));
    return 0;
  }
  if (command === "update") {
    const releaseId = positional[1];
    const closureSha256 = positional[2];
    if (!releaseId || !closureSha256) throw new Error("Usage: pidex update <release-id> <closure-sha256>");
    const receipt = await runtime.client.activateSourceUpdate({ releaseId, closureSha256 });
    runtime.stdout(JSON.stringify(receipt));
    return 0;
  }

  const policyOwner = commandOwners[command as keyof typeof commandOwners];
  const operationArguments = positional.slice(1);
  const argumentsDigest = createHash("sha256").update(JSON.stringify(operationArguments.length ? operationArguments : {})).digest("hex");
  const result = await runtime.client.run({ policyOwner, operation: command, argumentsDigest }, { detach });
  runtime.stdout(json || detach ? JSON.stringify(result.receipt) : `${result.receipt.operationId}: ${result.receipt.state}`);
  return result.receipt.state === "failed" ? 4 : 0;
}
