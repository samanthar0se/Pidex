import { z } from "zod";
import { mapWindowsNativeError } from "./errors.js";

const absoluteWindowsPath = z.string().regex(/^(?:[A-Za-z]:\\|\\\\)/);
const instanceId = z.string().min(1).max(128);
const certificateInputSchema = z.strictObject({
  instanceId,
  certificatePath: absoluteWindowsPath,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const taskInputSchema = z.strictObject({
  instanceId,
  owningSid: z.string().regex(/^S-1-/),
  name: z.string().min(1).max(238),
  executable: absoluteWindowsPath,
  arguments: z.array(z.string().max(4096)).max(64),
});
const firewallInputSchema = z.strictObject({
  instanceId,
  name: z.string().min(1).max(238),
  port: z.literal(47831),
});
const inspectionSchema = z.strictObject({
  state: z.enum(["absent", "matches", "drift"]),
  reasons: z.array(z.enum([
    "duplicate", "wrong-certificate", "wrong-store", "wrong-owner", "wrong-trigger",
    "wrong-run-level", "wrong-command", "disabled", "extra-profile", "wrong-port",
    "wrong-protocol", "wrong-direction", "wrong-action",
  ])).max(32),
});

export type CertificateIntegration = z.infer<typeof certificateInputSchema>;
export type TaskIntegration = z.infer<typeof taskInputSchema>;
export type FirewallIntegration = z.infer<typeof firewallInputSchema>;
export type IntegrationInspection = z.infer<typeof inspectionSchema>;

export interface RawWindowsIntegrations {
  inspectCertificate(input: CertificateIntegration): Promise<unknown>;
  installCertificate(input: CertificateIntegration): Promise<void>;
  removeCertificate(input: CertificateIntegration): Promise<void>;
  inspectTask(input: TaskIntegration): Promise<unknown>;
  registerTask(input: TaskIntegration): Promise<void>;
  removeTask(input: TaskIntegration): Promise<void>;
  inspectFirewallRule(input: FirewallIntegration): Promise<unknown>;
  ensureFirewallRule(input: FirewallIntegration): Promise<void>;
  removeFirewallRule(input: FirewallIntegration): Promise<void>;
}

export interface SourcePreparationIntegrationPort {
  inspectCertificate(input: CertificateIntegration): Promise<IntegrationInspection>;
  ensureCertificate(input: CertificateIntegration): Promise<{ changed: boolean; inspection: IntegrationInspection }>;
  inspectFirewallRule(input: FirewallIntegration): Promise<IntegrationInspection>;
  ensureFirewallRule(input: FirewallIntegration): Promise<{ changed: boolean; inspection: IntegrationInspection }>;
}

export function createWindowsIntegrationPorts(raw: RawWindowsIntegrations) {
  const inspectCertificate = (input: CertificateIntegration) => inspect(raw.inspectCertificate, certificateInputSchema, input, "inspect-certificate");
  const inspectTask = (input: TaskIntegration) => inspect(raw.inspectTask, taskInputSchema, input, "inspect-task");
  const inspectFirewallRule = (input: FirewallIntegration) => inspect(raw.inspectFirewallRule, firewallInputSchema, input, "inspect-firewall-rule");
  const ensureCertificate = (input: CertificateIntegration) => ensure(inspectCertificate, raw.installCertificate, certificateInputSchema, input, "install-certificate");
  const ensureTask = (input: TaskIntegration) => ensure(inspectTask, raw.registerTask, taskInputSchema, input, "register-task");
  const ensureCanonicalRule = (input: FirewallIntegration) => ensure(inspectFirewallRule, raw.ensureFirewallRule, firewallInputSchema, input, "ensure-firewall-rule");

  return {
    installation: { inspectCertificate, ensureCertificate, inspectTask, ensureTask,
      removeCertificate: remover(raw.removeCertificate, certificateInputSchema, "remove-certificate"),
      removeTask: remover(raw.removeTask, taskInputSchema, "remove-task") },
    firewall: { inspectCanonicalRule: inspectFirewallRule, ensureCanonicalRule,
      removeCanonicalRule: remover(raw.removeFirewallRule, firewallInputSchema, "remove-firewall-rule") },
    // Deliberately narrow: source prepare is structurally unable to register a task.
    sourcePreparation: { inspectCertificate, ensureCertificate, inspectFirewallRule, ensureFirewallRule: ensureCanonicalRule } satisfies SourcePreparationIntegrationPort,
  };
}

async function inspect<T>(fn: (input: T) => Promise<unknown>, schema: z.ZodType<T>, input: T, operation: string): Promise<IntegrationInspection> {
  const parsed = schema.parse(input);
  try { return inspectionSchema.parse(await fn(parsed)); }
  catch (error) { throw mapWindowsNativeError(error, operation); }
}

async function ensure<T>(inspectFn: (input: T) => Promise<IntegrationInspection>, fn: (input: T) => Promise<void>, schema: z.ZodType<T>, input: T, operation: string) {
  const parsed = schema.parse(input);
  const before = await inspectFn(parsed);
  if (before.state === "matches") return { changed: false, inspection: before } as const;
  try { await fn(parsed); }
  catch (error) { throw mapWindowsNativeError(error, operation); }
  const after = await inspectFn(parsed);
  if (after.state !== "matches") {
    throw mapWindowsNativeError({
      operation, category: "conflict", domain: "win32", code: 0,
      retryable: false, detail: "managed integration remains drifted",
    }, operation);
  }
  return { changed: true, inspection: after } as const;
}

function remover<T>(fn: (input: T) => Promise<void>, schema: z.ZodType<T>, operation: string) {
  return async (input: T): Promise<void> => {
    try { await fn(schema.parse(input)); }
    catch (error) { throw mapWindowsNativeError(error, operation); }
  };
}
