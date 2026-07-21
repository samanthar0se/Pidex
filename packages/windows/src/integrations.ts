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

interface NativeIntegrationOperation<T, TResult> {
  invoke(input: T): Promise<TResult>;
  operation: string;
}

interface ManagedIntegrationDefinition<T> {
  schema: z.ZodType<T>;
  inspect: NativeIntegrationOperation<T, unknown>;
  ensure: NativeIntegrationOperation<T, void>;
  remove: NativeIntegrationOperation<T, void>;
}

export function createWindowsIntegrationPorts(raw: RawWindowsIntegrations) {
  const certificate = createManagedIntegration({
    schema: certificateInputSchema,
    inspect: { invoke: raw.inspectCertificate, operation: "inspect-certificate" },
    ensure: { invoke: raw.installCertificate, operation: "install-certificate" },
    remove: { invoke: raw.removeCertificate, operation: "remove-certificate" },
  });
  const task = createManagedIntegration({
    schema: taskInputSchema,
    inspect: { invoke: raw.inspectTask, operation: "inspect-task" },
    ensure: { invoke: raw.registerTask, operation: "register-task" },
    remove: { invoke: raw.removeTask, operation: "remove-task" },
  });
  const firewall = createManagedIntegration({
    schema: firewallInputSchema,
    inspect: { invoke: raw.inspectFirewallRule, operation: "inspect-firewall-rule" },
    ensure: { invoke: raw.ensureFirewallRule, operation: "ensure-firewall-rule" },
    remove: { invoke: raw.removeFirewallRule, operation: "remove-firewall-rule" },
  });

  return {
    installation: {
      inspectCertificate: certificate.inspect,
      ensureCertificate: certificate.ensure,
      removeCertificate: certificate.remove,
      inspectTask: task.inspect,
      ensureTask: task.ensure,
      removeTask: task.remove,
    },
    firewall: {
      inspectCanonicalRule: firewall.inspect,
      ensureCanonicalRule: firewall.ensure,
      removeCanonicalRule: firewall.remove,
    },
    // Deliberately narrow: source prepare is structurally unable to register a task.
    sourcePreparation: {
      inspectCertificate: certificate.inspect,
      ensureCertificate: certificate.ensure,
      inspectFirewallRule: firewall.inspect,
      ensureFirewallRule: firewall.ensure,
    } satisfies SourcePreparationIntegrationPort,
  };
}

function createManagedIntegration<T>(definition: ManagedIntegrationDefinition<T>) {
  const inspect = (input: T) => inspectIntegration(
    definition.inspect.invoke,
    definition.schema,
    input,
    definition.inspect.operation,
  );

  return {
    inspect,
    ensure: (input: T) => ensureIntegration(
      inspect,
      definition.ensure.invoke,
      definition.schema,
      input,
      definition.ensure.operation,
    ),
    remove: createIntegrationRemover(
      definition.remove.invoke,
      definition.schema,
      definition.remove.operation,
    ),
  };
}

async function inspectIntegration<T>(
  nativeInspect: (input: T) => Promise<unknown>,
  schema: z.ZodType<T>,
  input: T,
  operation: string,
): Promise<IntegrationInspection> {
  const parsed = schema.parse(input);
  try { return inspectionSchema.parse(await nativeInspect(parsed)); }
  catch (error) { throw mapWindowsNativeError(error, operation); }
}

async function ensureIntegration<T>(
  inspectCurrent: (input: T) => Promise<IntegrationInspection>,
  nativeEnsure: (input: T) => Promise<void>,
  schema: z.ZodType<T>,
  input: T,
  operation: string,
) {
  const parsed = schema.parse(input);
  const before = await inspectCurrent(parsed);
  if (before.state === "matches") return { changed: false, inspection: before } as const;
  try { await nativeEnsure(parsed); }
  catch (error) { throw mapWindowsNativeError(error, operation); }
  const after = await inspectCurrent(parsed);
  if (after.state !== "matches") {
    throw mapWindowsNativeError({
      operation, category: "conflict", domain: "win32", code: 0,
      retryable: false, detail: "managed integration remains drifted",
    }, operation);
  }
  return { changed: true, inspection: after } as const;
}

function createIntegrationRemover<T>(
  nativeRemove: (input: T) => Promise<void>,
  schema: z.ZodType<T>,
  operation: string,
) {
  return async (input: T): Promise<void> => {
    try { await nativeRemove(schema.parse(input)); }
    catch (error) { throw mapWindowsNativeError(error, operation); }
  };
}
