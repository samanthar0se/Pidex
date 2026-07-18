import { z } from "zod";

export const protocolVersion = "1.0";

export const hostStatusSchema = z.object({
  hostId: z.string(),
  releaseId: z.string(),
  readiness: z.literal("ready"),
  warnings: z.array(
    z.object({
      severity: z.literal("high"),
      code: z.literal("firewall-enforcement-degraded"),
      detail: z.string(),
    }),
  ),
  synchronization: z.object({
    epoch: z.string(),
    sequence: z.number(),
    cursor: z.string(),
  }),
});

export type HostStatus = z.infer<typeof hostStatusSchema>;

export const projectSummarySchema = z.object({
  projectId: z.string(),
  name: z.string(),
});
export const workspaceSummarySchema = z.object({
  workspaceId: z.string(),
  projectId: z.string(),
  name: z.string(),
});
export const sessionSummarySchema = z.object({
  sessionId: z.string(),
  projectId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  retention: z.literal("available"),
  residency: z.literal("sleeping"),
  metadataRevision: z.number(),
  timelineRevision: z.number(),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("host.snapshot"),
    protocolVersion: z.literal(protocolVersion),
    status: hostStatusSchema,
    projects: z.array(projectSummarySchema),
    workspaces: z.array(workspaceSummarySchema),
    sessions: z.array(sessionSummarySchema),
  }),
  z.object({
    type: z.literal("host.change-set"),
    cursor: z.string(),
    changes: z.array(z.object({ type: z.literal("session.created"), session: sessionSummarySchema })),
  }),
  z.object({
    type: z.literal("command.outcome"),
    commandId: z.string(),
    outcome: z.enum(["accepted", "rejected"]),
    error: z.string().optional(),
  }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type HostSnapshot = Extract<ServerMessage, { type: "host.snapshot" }>;

export function parseServerMessage(data: string): HostSnapshot {
  const message = serverMessageSchema.parse(JSON.parse(data));
  if (message.type !== "host.snapshot") throw new Error("Expected Host snapshot");
  return message;
}
