import { z } from "zod";

export const protocolVersion = "1.1";
export const protocolMajor = 1;
export const protocolMinor = 1;

export const protocolCapabilities = [
  { id: "scope.host", version: 1 },
  { id: "scope.session", version: 1 },
  { id: "session.create", version: 1 },
  { id: "session.rename", version: 1 },
  { id: "session.archive", version: 1 },
  { id: "session.restore", version: 1 },
  { id: "session.fork", version: 1 },
  { id: "run.submit", version: 1 },
  { id: "presentation.effects", version: 1 },
  { id: "run.follow-up", version: 1 },
  { id: "run.steer", version: 1 },
  { id: "run.release", version: 1 },
  { id: "run.cancel", version: 1 },
  { id: "run.stop", version: 1 },
  { id: "durability.coverage", version: 1 },
] as const;

const protocolSchema = z.object({
  major: z.number().int(),
  minor: z.number().int(),
});

const clientCapabilitySchema = z.object({
  id: z.string(),
  minVersion: z.number().int().positive().optional(),
  maxVersion: z.number().int().positive().optional(),
  version: z.number().int().positive().optional(),
});

const capabilityConstraintsSchema = z.object({
  values: z.array(z.string()).optional(),
  maximumBytes: z.number().int().positive().optional(),
});

const hostCapabilitySchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  constraints: capabilityConstraintsSchema.optional(),
});

const optionalEnvelopeSchema = z
  .object({ optional: z.record(z.string(), z.unknown()).optional() })
  .passthrough();

export const clientHelloSchema = z
  .object({
    type: z.literal("client.hello"),
    expectedHostId: z.string(),
    protocols: z.array(protocolSchema),
    capabilities: z.array(clientCapabilitySchema),
  })
  .passthrough();
export type ClientHello = z.infer<typeof clientHelloSchema>;

export function clientHello(expectedHostId: string): ClientHello {
  return {
    type: "client.hello",
    expectedHostId,
    protocols: [{ major: protocolMajor, minor: protocolMinor }],
    capabilities: protocolCapabilities.map(capability => ({
      id: capability.id,
      minVersion: capability.version,
      maxVersion: capability.version,
    })),
  };
}

export const durabilityRoles = [
  "host-data",
  "installation-release",
  "pi-checkpoint",
] as const;

const durabilityStateSchema = z.enum([
  "covered",
  "outside-boundary",
  "indeterminate",
]);
const durabilityCoverageSchema = z.object({
  aggregate: durabilityStateSchema,
  assessment: z.enum(["assessment-pending", "complete"]),
  roles: z.array(
    z.object({
      role: z.enum(durabilityRoles),
      state: durabilityStateSchema,
      reason: z.enum([
        "fixed-ntfs",
        "outside-fixed-ntfs",
        "assessment-pending",
        "classification-unavailable",
      ]),
    }),
  ),
});
export type DurabilityCoverage = z.infer<typeof durabilityCoverageSchema>;

export const hostStatusSchema = z.object({
  hostId: z.string(),
  releaseId: z.string(),
  readiness: z.literal("ready"),
  warnings: z.array(
    z.union([
      z.object({
        severity: z.literal("high"),
        code: z.literal("firewall-enforcement-degraded"),
        detail: z.string(),
      }),
      z.object({
        severity: z.literal("medium"),
        code: z.literal("durability-coverage-degraded"),
        role: z.enum(durabilityRoles),
        state: z.enum(["outside-boundary", "indeterminate"]),
        reason: z.string(),
        detail: z.string(),
      }),
    ]),
  ),
  durability: durabilityCoverageSchema,
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
  name: z.string(),
  projectId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  retention: z.literal("available"),
  /** Present for the distinct archived catalog; omitted for compatible normal discovery. */
  availability: z.literal("archived").optional(),
  residency: z.enum(["sleeping", "resident"]),
  metadataRevision: z.number(),
  timelineRevision: z.number(),
  parentSessionId: z.string().nullable().optional(),
  forkPointEntryId: z.string().nullable().optional(),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

const terminalRunStateSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const activeRunStateSchema = z.enum(["queued", "executing", "cancelling", "held"]);

export const runRecordSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
  sessionOrder: z.number(),
  prompt: z.string(),
  state: z.union([activeRunStateSchema, terminalRunStateSchema]),
});

export const acceptedRunSchema = runRecordSchema.extend({
  state: activeRunStateSchema,
});

export const completedRunSchema = runRecordSchema.extend({
  state: z.literal("completed"),
});

export const terminalRunSchema = runRecordSchema.extend({
  state: terminalRunStateSchema,
});

export const timelineEntrySchema = z.object({
  entryId: z.string(),
  runId: z.string().nullable(),
  order: z.number(),
  kind: z.enum([
    "prompt",
    "response",
    "assistant",
    "tool",
    "run",
    "outcome",
    "lifecycle",
    "interaction",
    "steering",
  ]),
  text: z.string(),
  blobId: z.string().nullable().optional(),
  revision: z.number().int().positive(),
  finalized: z.coerce.boolean(),
  toolCallId: z.string().nullable().optional(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
export type AcceptedRun = z.infer<typeof acceptedRunSchema>;
export type CompletedRun = z.infer<typeof completedRunSchema>;
export type TerminalRun = z.infer<typeof terminalRunSchema>;
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const timelineWindowSchema = z.object({
  entries: z.array(timelineEntrySchema),
  /** Opaque cursor for the page immediately preceding this window. */
  olderCursor: z.string().nullable(),
});
export type TimelineWindow = z.infer<typeof timelineWindowSchema>;

export const timelineChangeSchema = z.object({
  baseRevision: z.number().int(),
  revision: z.number().int(),
  entry: timelineEntrySchema,
});

export const interactionSchema = z.object({
  interactionId: z.string(),
  sessionId: z.string(),
  runId: z.string().nullable(),
  workerGeneration: z.number().int().positive(),
  correlationId: z.string(),
  kind: z.enum(["select", "confirm", "input", "editor"]),
  payload: z
    .object({
      message: z.string(),
      options: z.array(z.string()).optional(),
      defaultValue: z.union([z.string(), z.boolean()]).optional(),
    })
    .strict(),
  provenance: z.string().optional(),
  state: z.enum([
    "open",
    "resolving",
    "responded",
    "dismissed",
    "expired",
    "withdrawn",
  ]),
  revision: z.number().int().positive(),
  createdAt: z.number(),
  deadlineAt: z.number().nullable(),
  terminalCause: z.string().nullable(),
  respondedAt: z.number().nullable(),
  respondingDeviceLabel: z.string().nullable(),
  applicationProven: z.boolean().nullable(),
});
export type Interaction = z.infer<typeof interactionSchema>;

export type TimelineChange = z.infer<typeof timelineChangeSchema>;

export const synchronizationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("host") }),
  z.object({ kind: z.literal("session"), sessionId: z.string() }),
]);

const synchronizationBarrierSchema = z.object({
  scope: synchronizationScopeSchema,
  cursor: z.string(),
  resourceRevisions: z.record(z.string(), z.number()),
  protocolBasis: z.string(),
  capabilities: z.array(z.string()),
});

export const hostChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.created"),
    session: sessionSummarySchema,
  }),
  z.object({
    type: z.literal("session.forked"),
    session: sessionSummarySchema,
  }),
  z.object({
    type: z.literal("session.renamed"),
    session: sessionSummarySchema,
  }),
  z.object({
    type: z.literal("session.residency-changed"),
    session: sessionSummarySchema,
  }),
  z.object({
    type: z.enum(["session.archived", "session.restored"]),
    session: sessionSummarySchema,
  }),
]).and(optionalEnvelopeSchema);

export type HostChange = z.infer<typeof hostChangeSchema>;

const presentationEffectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notification"),
    level: z.enum(["info", "warning", "error"]),
    text: z.string(),
  }),
  z.object({
    type: z.literal("status"),
    key: z.string(),
    text: z.string().nullable(),
  }),
  z.object({
    type: z.literal("widget"),
    key: z.string(),
    text: z.string().nullable(),
  }),
  z.object({
    type: z.literal("title"),
    text: z.string().nullable(),
  }),
  z.object({
    type: z.literal("editor-text"),
    text: z.string(),
    disposition: z.enum(["inject", "suggest"]),
    viewId: z.string().optional(),
    draftRevision: z.number().int().nonnegative().optional(),
  }),
]);

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("host.hello"),
    hostId: z.string(),
    protocols: z.array(protocolSchema),
    capabilities: z.array(hostCapabilitySchema),
  }).passthrough(),
  z.object({
    type: z.literal("protocol.admitted"),
    hostId: z.string(),
    protocol: protocolSchema,
    capabilities: z.array(hostCapabilitySchema),
  }).passthrough(),
  z.object({
    type: z.literal("protocol.update-required"),
    reason: z.enum(["host-mismatch", "no-common-major", "missing-capability"]),
    hostId: z.string(),
  }).passthrough(),
  z.object({
    type: z.literal("delivery.resynchronize"),
    reason: z.literal("outbound-queue-overflow"),
    lastCursor: z.string(),
  }).passthrough(),
  z.object({
    type: z.literal("durability.coverage-changed"),
    coverage: durabilityCoverageSchema,
    warnings: hostStatusSchema.shape.warnings,
  }).passthrough(),
  z.object({
    type: z.literal("host.snapshot"),
    protocolVersion: z.string(),
    status: hostStatusSchema,
    projects: z.array(projectSummarySchema),
    workspaces: z.array(workspaceSummarySchema),
    sessions: z.array(sessionSummarySchema),
    archivedSessions: z.array(sessionSummarySchema),
  }),
  z.object({
    type: z.literal("host.change-set"),
    cursor: z.string(),
    changes: z.array(hostChangeSchema),
  }),
  z.object({
    type: z.literal("scope.reset"),
    reason: z.enum([
      "new-scope",
      "host-mismatch",
      "epoch-mismatch",
      "protocol-mismatch",
      "history-unavailable",
      "revision-mismatch",
    ]),
    barrier: synchronizationBarrierSchema,
    snapshot: z.union([
      z.object({
        projects: z.array(projectSummarySchema),
        workspaces: z.array(workspaceSummarySchema),
        sessions: z.array(sessionSummarySchema),
        archivedSessions: z.array(sessionSummarySchema),
      }),
      z.object({
        session: sessionSummarySchema,
        timeline: z.array(timelineEntrySchema).optional(),
        timelineWindow: timelineWindowSchema.optional(),
        runs: z.array(runRecordSchema).optional(),
        interactions: z.array(interactionSchema).optional(),
      }),
    ]),
  }),
  z.object({
    type: z.literal("scope.current"),
    scope: synchronizationScopeSchema,
    cursor: z.string(),
  }),
  z.object({
    type: z.literal("command.outcome"),
    commandId: z.string(),
    outcome: z.enum(["accepted", "rejected"]),
    error: z.string().optional(),
    receipt: z.object({ digest: z.string(), commitCursor: z.string() }).optional(),
    failedPrecondition: z.literal("metadataRevision").optional(),
    currentMetadataRevision: z.number().optional(),
    reconciliationCursor: z.string().optional(),
    runId: z.string().optional(),
  }),
  z.object({
    type: z.literal("run.completed"),
    run: terminalRunSchema,
    timeline: z.array(timelineEntrySchema),
  }),
  z.object({
    type: z.literal("run.execution"),
    sessionId: z.string(),
    runId: z.string(),
    state: z.enum(["executing", "cancelling"]),
    workerGeneration: z.string(),
    timelineRevision: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("presentation.effect"),
    sessionId: z.string(),
    workerGeneration: z.string(),
    effect: presentationEffectSchema,
  }),
  z.object({
    type: z.literal("presentation.reset"),
    sessionId: z.string(),
    workerGeneration: z.string(),
  }),
  timelineChangeSchema.extend({
    type: z.literal("timeline.change"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("interaction.change"),
    interaction: interactionSchema,
  }),
]).and(optionalEnvelopeSchema);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type HostSnapshot = Extract<ServerMessage, { type: "host.snapshot" }>;

export function parseServerMessage(data: string): HostSnapshot {
  const message = serverMessageSchema.parse(JSON.parse(data));
  if (message.type !== "host.snapshot") {
    throw new Error("Expected Host snapshot");
  }
  return message;
}

/** Unknown required semantics are never ignorable; optional envelope fields are. */
export function unsupportedRequiredSemantics(
  message: unknown,
  supported: ReadonlySet<string>,
): string[] {
  if (!message || typeof message !== "object") {
    return [];
  }

  const required = (message as { requiredSemantics?: unknown }).requiredSemantics;
  if (!Array.isArray(required) || !required.every(item => typeof item === "string")) {
    return required === undefined ? [] : ["malformed-required-semantics"];
  }

  return required.filter(item => !supported.has(item));
}
