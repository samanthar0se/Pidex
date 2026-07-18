import { z } from "zod";

export const protocolVersion = "1.0";

export const hostStatusSchema = z.object({
  hostId: z.string(),
  releaseId: z.string(),
  readiness: z.literal("ready"),
  warnings: z.array(z.object({
    severity: z.literal("high"),
    code: z.literal("firewall-enforcement-degraded"),
    detail: z.string(),
  })),
  synchronization: z.object({
    epoch: z.string(),
    sequence: z.number(),
    cursor: z.string(),
  }),
});

export type HostStatus = z.infer<typeof hostStatusSchema>;

export const serverMessageSchema = z.object({
  type: z.literal("host.snapshot"),
  protocolVersion: z.literal(protocolVersion),
  status: hostStatusSchema,
});

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function parseServerMessage(data: string): ServerMessage {
  return serverMessageSchema.parse(JSON.parse(data));
}
