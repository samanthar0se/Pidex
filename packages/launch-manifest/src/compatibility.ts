import { z } from "zod";

const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const addonAbiSchema = z.string().regex(/^napi-\d+$/);

const nodeLaneSchema = z.strictObject({
  role: z.enum(["primary", "secondary"]),
  version: semanticVersionSchema,
  architecture: z.literal("x64"),
  distribution: z.string().url(),
  sha256: sha256Schema,
  nodeApi: nonnegativeIntegerSchema,
  addonAbi: addonAbiSchema,
  addonGeneration: nonnegativeIntegerSchema,
  workerGeneration: nonnegativeIntegerSchema,
  protocolGeneration: nonnegativeIntegerSchema,
  schemaGeneration: nonnegativeIntegerSchema,
});

export const hostCompatibilityRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    candidate: z.string().min(1),
    pi: z.strictObject({
      version: z.literal("0.80.10"),
      integrity: z.string().startsWith("sha512-"),
    }),
    nodeLanes: z.tuple([nodeLaneSchema, nodeLaneSchema]),
    piArtifactPaths: z
      .array(
        z.strictObject({
          sourceGeneration: nonnegativeIntegerSchema,
          targetGeneration: nonnegativeIntegerSchema,
          converterArtifact: z.literal("maintenance"),
        }),
      )
      .min(1),
  })
  .superRefine((record, context) => {
    const [primaryLane, secondaryLane] = record.nodeLanes;
    if (
      primaryLane.role !== "primary" ||
      secondaryLane.role !== "secondary"
    ) {
      context.addIssue({
        code: "custom",
        path: ["nodeLanes"],
        message: "Node lanes must be ordered primary, secondary",
      });
    }

    for (const [index, lane] of record.nodeLanes.entries()) {
      if (lane.addonAbi !== `napi-${lane.nodeApi}`) {
        context.addIssue({
          code: "custom",
          path: ["nodeLanes", index, "addonAbi"],
          message: "addon ABI must match Node-API",
        });
      }
    }
  });

export type HostCompatibilityRecord = z.infer<
  typeof hostCompatibilityRecordSchema
>;

export function parseHostCompatibilityRecord(
  input: unknown,
): HostCompatibilityRecord {
  return hostCompatibilityRecordSchema.parse(input);
}
