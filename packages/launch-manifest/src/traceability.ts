import { z } from "zod";

const sourceSchema = z.strictObject({
  kind: z.enum(["requirement", "retired-scaffold-test"]),
  id: z.string().min(1),
});

const evidenceTierSchema = z.enum([
  "portable",
  "windows-vm",
  "hyper-v",
]);

const mappingSchema = sourceSchema.extend({
  case: z.string().min(1),
  evidenceTier: evidenceTierSchema,
  observablePostcondition: z.string().min(1),
});

type TraceabilityMapping = z.infer<typeof mappingSchema>;
type EvidenceTier = z.infer<typeof evidenceTierSchema>;

interface EvidenceCase {
  readonly evidenceTier: EvidenceTier;
  readonly observablePostcondition: string;
}

export const traceabilityManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogRevision: z.string().min(1),
  claim: z.literal("runnable-host-scaffold-replacement"),
  mappings: z.array(mappingSchema),
});

export type TraceabilityManifest = z.infer<typeof traceabilityManifestSchema>;
export type TraceabilitySource = z.infer<typeof sourceSchema>;

export interface TraceabilityCatalog {
  readonly revision: string;
  readonly requirements: readonly string[];
  readonly retiredScaffoldTests: readonly string[];
  readonly cases: Readonly<Record<string, EvidenceCase>>;
}

export interface TraceabilityResult {
  readonly complete: boolean;
  readonly supportsScaffoldReplacementClaim: boolean;
  readonly failures: readonly string[];
}

/**
 * Checks the mapping against independently supplied requirement, retired-test,
 * and successor-case inventories. Callers must not derive the catalog from the
 * manifest: that would make a missing mapping invisible.
 */
export function evaluateTraceability(
  input: unknown,
  catalog: TraceabilityCatalog,
): TraceabilityResult {
  const parsed = traceabilityManifestSchema.safeParse(input);
  if (!parsed.success) {
    return incompleteResult([`malformed:${z.prettifyError(parsed.error)}`]);
  }

  const manifest = parsed.data;
  const failures = new Set<string>();
  if (manifest.catalogRevision !== catalog.revision) {
    failures.add("stale:catalog-revision");
  }

  const expectedSourceKeys = new Set([
    ...catalog.requirements.map((id) => `requirement:${id}`),
    ...catalog.retiredScaffoldTests.map((id) => `retired-scaffold-test:${id}`),
  ]);
  const mappingsBySourceKey = new Map<string, TraceabilityMapping>();

  for (const mapping of manifest.mappings) {
    const sourceKey = `${mapping.kind}:${mapping.id}`;
    if (!expectedSourceKeys.has(sourceKey)) {
      failures.add(`stale:source:${sourceKey}`);
    }

    const previousMapping = mappingsBySourceKey.get(sourceKey);
    if (previousMapping) {
      failures.add(`duplicate:${sourceKey}`);
      const mappingsContradict =
        previousMapping.case !== mapping.case ||
        previousMapping.evidenceTier !== mapping.evidenceTier ||
        previousMapping.observablePostcondition !==
          mapping.observablePostcondition;
      if (mappingsContradict) {
        failures.add(`contradictory:${sourceKey}`);
      }
    }
    mappingsBySourceKey.set(sourceKey, mapping);

    const catalogCase = catalog.cases[mapping.case];
    if (!catalogCase) {
      failures.add(`stale:case:${mapping.case}`);
      continue;
    }

    const mappingContradictsCase =
      catalogCase.evidenceTier !== mapping.evidenceTier ||
      catalogCase.observablePostcondition !== mapping.observablePostcondition;
    if (mappingContradictsCase) {
      failures.add(`contradictory:case:${mapping.case}`);
    }
  }

  for (const sourceKey of expectedSourceKeys) {
    if (!mappingsBySourceKey.has(sourceKey)) {
      failures.add(`missing:${sourceKey}`);
    }
  }

  if (failures.size === 0) {
    return completeResult();
  }
  return incompleteResult([...failures].sort());
}

export function assertCompleteTraceability(
  input: unknown,
  catalog: TraceabilityCatalog,
): TraceabilityManifest {
  const result = evaluateTraceability(input, catalog);
  if (!result.complete) {
    throw new Error(
      `incomplete requirement traceability: ${result.failures.join(", ")}`,
    );
  }
  return traceabilityManifestSchema.parse(input);
}

function completeResult(): TraceabilityResult {
  return { complete: true, supportsScaffoldReplacementClaim: true, failures: [] };
}

function incompleteResult(failures: readonly string[]): TraceabilityResult {
  return { complete: false, supportsScaffoldReplacementClaim: false, failures };
}
