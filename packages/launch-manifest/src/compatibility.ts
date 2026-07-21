import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const generationSchema = z.number().int().nonnegative();

const nodeLaneSchema = z.strictObject({
  role: z.enum(["primary", "secondary"]),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  architecture: z.literal("x64"),
  distribution: z.string().url(),
  sha256: sha256Schema,
  nodeApi: generationSchema,
  addonAbi: z.string().regex(/^napi-\d+$/),
  addonGeneration: generationSchema,
  workerGeneration: generationSchema,
  protocolGeneration: generationSchema,
  schemaGeneration: generationSchema,
});

export const hostCompatibilityRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidate: z.string().min(1),
  pi: z.strictObject({
    version: z.literal("0.80.10"),
    integrity: z.string().startsWith("sha512-"),
  }),
  nodeLanes: z.tuple([nodeLaneSchema, nodeLaneSchema]),
  piArtifactPaths: z.array(
    z.strictObject({
      sourceGeneration: generationSchema,
      targetGeneration: generationSchema,
      converterArtifact: z.literal("maintenance"),
    }),
  ).min(1),
}).superRefine((record, context) => {
  if (record.nodeLanes[0].role !== "primary" || record.nodeLanes[1].role !== "secondary") {
    context.addIssue({ code: "custom", path: ["nodeLanes"], message: "Node lanes must be ordered primary, secondary" });
  }
  for (const [index, lane] of record.nodeLanes.entries()) {
    if (lane.addonAbi !== `napi-${lane.nodeApi}`) {
      context.addIssue({ code: "custom", path: ["nodeLanes", index, "addonAbi"], message: "addon ABI must match Node-API" });
    }
  }
});

export type HostCompatibilityRecord = z.infer<typeof hostCompatibilityRecordSchema>;

export function parseHostCompatibilityRecord(input: unknown): HostCompatibilityRecord {
  return hostCompatibilityRecordSchema.parse(input);
}
