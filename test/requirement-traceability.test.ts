import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompleteTraceability,
  evaluateTraceability,
  type TraceabilityCatalog,
} from "../packages/launch-manifest/src/index.js";

const catalog: TraceabilityCatalog = {
  revision: "prd-80@2026-07-21",
  requirements: ["R-MANIFEST-GUARDS", "R-REAL-WORKER"],
  retiredScaffoldTests: ["old-product-adapter:starts"],
  cases: {
    "manifest rejects deterministic product ports": {
      evidenceTier: "portable",
      observablePostcondition: "Parsing fails before any child can spawn.",
    },
    "exact Pi worker runs in a contained child": {
      evidenceTier: "windows-vm",
      observablePostcondition: "The Session child reports matching Pi and Job identities.",
    },
    "production composition starts without old adapter": {
      evidenceTier: "hyper-v",
      observablePostcondition: "The exact closure reaches ready with no scaffold loaded.",
    },
  },
};

const mappings = [
  {
    kind: "requirement",
    id: "R-MANIFEST-GUARDS",
    case: "manifest rejects deterministic product ports",
    evidenceTier: "portable",
    observablePostcondition: "Parsing fails before any child can spawn.",
  },
  {
    kind: "requirement",
    id: "R-REAL-WORKER",
    case: "exact Pi worker runs in a contained child",
    evidenceTier: "windows-vm",
    observablePostcondition: "The Session child reports matching Pi and Job identities.",
  },
  {
    kind: "retired-scaffold-test",
    id: "old-product-adapter:starts",
    case: "production composition starts without old adapter",
    evidenceTier: "hyper-v",
    observablePostcondition: "The exact closure reaches ready with no scaffold loaded.",
  },
] as const;

function manifest(customMappings: readonly unknown[] = mappings): unknown {
  return {
    schemaVersion: 1,
    catalogRevision: catalog.revision,
    claim: "runnable-host-scaffold-replacement",
    mappings: customMappings,
  };
}

test("complete requirement and retired-scaffold mappings support the claim", () => {
  const result = evaluateTraceability(manifest(), catalog);
  assert.deepEqual(result, {
    complete: true,
    supportsScaffoldReplacementClaim: true,
    failures: [],
  });
  assert.doesNotThrow(() => assertCompleteTraceability(manifest(), catalog));
});

test("missing and stale mappings fail closed", () => {
  const stale = { ...mappings[0], id: "REMOVED" };
  const result = evaluateTraceability(manifest([stale, ...mappings.slice(2)]), catalog);
  assert.equal(result.supportsScaffoldReplacementClaim, false);
  assert.ok(result.failures.includes("stale:source:requirement:REMOVED"));
  assert.ok(result.failures.includes("missing:requirement:R-MANIFEST-GUARDS"));
  assert.ok(result.failures.includes("missing:requirement:R-REAL-WORKER"));
});

test("duplicate or contradictory mappings fail completeness", () => {
  const contradiction = {
    ...mappings[0],
    case: "exact Pi worker runs in a contained child",
    evidenceTier: "windows-vm",
    observablePostcondition: "The Session child reports matching Pi and Job identities.",
  };
  const result = evaluateTraceability(
    manifest([...mappings, mappings[0], contradiction]),
    catalog,
  );
  assert.ok(result.failures.includes("duplicate:requirement:R-MANIFEST-GUARDS"));
  assert.ok(result.failures.includes("contradictory:requirement:R-MANIFEST-GUARDS"));
  assert.equal(result.complete, false);
});

test("case tier and postcondition must match the evidence catalog", () => {
  const changed = { ...mappings[0], observablePostcondition: "Something else." };
  const result = evaluateTraceability(manifest([changed, ...mappings.slice(1)]), catalog);
  assert.ok(
    result.failures.includes(
      "contradictory:case:manifest rejects deterministic product ports",
    ),
  );
});
