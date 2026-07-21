import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const status = z.enum(["passed", "failed", "missing", "incomplete", "stale"]);
const gates = ["traceability", "windows-vm", "primary-hyper-v"] as const;
const scaffoldNames = [
  "oldProductAdapter", "inProcessPi", "mutableSource", "deterministicProductFallback",
  "parallelReleaseSelector", "lanCli",
] as const;

const inputSchema = z.strictObject({
  candidate: z.string().min(1),
  attemptedAt: z.iso.datetime(),
  identities: z.strictObject({
    closureSha256: sha256, addonSha256: sha256, sbomSha256: sha256,
    launcherSha256: sha256, configSha256: sha256,
    piVersion: z.string().min(1), schemaGeneration: z.number().int().nonnegative(),
    toolchain: z.string().min(1),
    runtimes: z.tuple([
      z.strictObject({ lane: z.literal("primary"), nodeVersion: z.string().min(1), nodeApi: z.number().int().positive() }),
      z.strictObject({ lane: z.literal("secondary"), nodeVersion: z.string().min(1), nodeApi: z.number().int().positive() }),
    ]),
  }),
  evidence: z.array(z.strictObject({
    gate: z.enum(gates), status, candidate: z.string().min(1), artifactSha256: sha256,
    authoritativeAttempt: z.number().int().positive().optional(),
  })),
  retiredScaffolds: z.strictObject(Object.fromEntries(
    scaffoldNames.map(name => [name, z.enum(["unreachable", "reachable"])]),
  ) as Record<(typeof scaffoldNames)[number], z.ZodEnum<{ unreachable: "unreachable"; reachable: "reachable" }>>),
});

export type RunnableHostValidationInput = z.input<typeof inputSchema>;

const EXCLUDES = Object.freeze([
  "installer-readiness", "signed-distribution", "daily-driver-completion", "full-v1-promotion",
] as const);

export function publishRunnableHostValidation(input: RunnableHostValidationInput) {
  const parsed = inputSchema.parse(input);
  const failures: string[] = [];
  for (const gate of gates) {
    const records = parsed.evidence.filter(item => item.gate === gate);
    if (records.length !== 1) failures.push(`${gate}:${records.length === 0 ? "missing" : "duplicate"}`);
    const record = records[0];
    if (!record) continue;
    if (record.candidate !== parsed.candidate) failures.push(`${gate}:candidate-mismatch`);
    if (record.status !== "passed") failures.push(`${gate}:${record.status}`);
    if (gate !== "traceability" && record.authoritativeAttempt !== 1) failures.push(`${gate}:non-authoritative-attempt`);
  }
  for (const scaffold of scaffoldNames) {
    if (parsed.retiredScaffolds[scaffold] !== "unreachable") failures.push(`${scaffold}:reachable`);
  }
  if (failures.length) throw new Error(`runnable Host validation blocked: ${failures.join(", ")}`);
  return Object.freeze({
    schema: "pidex-runnable-host-validation-v1" as const,
    candidate: parsed.candidate,
    attemptedAt: parsed.attemptedAt,
    identities: parsed.identities,
    evidence: parsed.evidence,
    retiredScaffolds: parsed.retiredScaffolds,
    verdict: "passed" as const,
    claim: "runnable-host-scaffold-replacement" as const,
    excludes: EXCLUDES,
  });
}
