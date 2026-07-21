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
  readonly cases: Readonly<Record<string, {
    readonly evidenceTier: z.infer<typeof evidenceTierSchema>;
    readonly observablePostcondition: string;
  }>>;
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
    return failed([`malformed:${z.prettifyError(parsed.error)}`]);
  }

  const manifest = parsed.data;
  const failures = new Set<string>();
  if (manifest.catalogRevision !== catalog.revision) {
    failures.add("stale:catalog-revision");
  }

  const expected = new Set([
    ...catalog.requirements.map((id) => `requirement:${id}`),
    ...catalog.retiredScaffoldTests.map(
      (id) => `retired-scaffold-test:${id}`,
    ),
  ]);
  const seen = new Map<string, typeof manifest.mappings[number]>();

  for (const mapping of manifest.mappings) {
    const key = `${mapping.kind}:${mapping.id}`;
    if (!expected.has(key)) failures.add(`stale:source:${key}`);

    const previous = seen.get(key);
    if (previous) {
      failures.add(`duplicate:${key}`);
      if (
        previous.case !== mapping.case ||
        previous.evidenceTier !== mapping.evidenceTier ||
        previous.observablePostcondition !== mapping.observablePostcondition
      ) failures.add(`contradictory:${key}`);
    }
    seen.set(key, mapping);

    const evidenceCase = catalog.cases[mapping.case];
    if (!evidenceCase) {
      failures.add(`stale:case:${mapping.case}`);
    } else if (
      evidenceCase.evidenceTier !== mapping.evidenceTier ||
      evidenceCase.observablePostcondition !== mapping.observablePostcondition
    ) {
      failures.add(`contradictory:case:${mapping.case}`);
    }
  }

  for (const key of expected) {
    if (!seen.has(key)) failures.add(`missing:${key}`);
  }
  return failures.size === 0 ? passed() : failed([...failures].sort());
}

export function assertCompleteTraceability(
  input: unknown,
  catalog: TraceabilityCatalog,
): TraceabilityManifest {
  const result = evaluateTraceability(input, catalog);
  if (!result.complete) {
    throw new Error(`incomplete requirement traceability: ${result.failures.join(", ")}`);
  }
  return traceabilityManifestSchema.parse(input);
}

function passed(): TraceabilityResult {
  return { complete: true, supportsScaffoldReplacementClaim: true, failures: [] };
}

function failed(failures: readonly string[]): TraceabilityResult {
  return { complete: false, supportsScaffoldReplacementClaim: false, failures };
}
