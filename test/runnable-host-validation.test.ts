import assert from "node:assert/strict";
import test from "node:test";
import {
  publishRunnableHostValidation,
  type RunnableHostValidationInput,
} from "../packages/launch-manifest/src/index.js";

const digest = (value: string) => value.repeat(64);

function passingInput(): RunnableHostValidationInput {
  return {
    candidate: "runnable-host-prd-80-2026-07-21",
    attemptedAt: "2026-07-21T12:00:00.000Z",
    identities: {
      closureSha256: digest("1"), addonSha256: digest("2"), sbomSha256: digest("3"),
      launcherSha256: digest("4"), configSha256: digest("5"), piVersion: "0.80.10",
      schemaGeneration: 1, toolchain: "msvc-19.44.35207/windows-sdk-10.0.26100.0",
      runtimes: [
        { lane: "primary" as const, nodeVersion: "24.18.0", nodeApi: 10 },
        { lane: "secondary" as const, nodeVersion: "22.23.1", nodeApi: 10 },
      ],
    },
    evidence: [
      { gate: "traceability" as const, status: "passed" as const, candidate: "runnable-host-prd-80-2026-07-21", artifactSha256: digest("a") },
      { gate: "windows-vm" as const, status: "passed" as const, candidate: "runnable-host-prd-80-2026-07-21", artifactSha256: digest("b"), authoritativeAttempt: 1 },
      { gate: "primary-hyper-v" as const, status: "passed" as const, candidate: "runnable-host-prd-80-2026-07-21", artifactSha256: digest("c"), authoritativeAttempt: 1 },
    ],
    retiredScaffolds: {
      oldProductAdapter: "unreachable" as const,
      inProcessPi: "unreachable" as const,
      mutableSource: "unreachable" as const,
      deterministicProductFallback: "unreachable" as const,
      parallelReleaseSelector: "unreachable" as const,
      lanCli: "unreachable" as const,
    },
  };
}

test("publishes only the exact bounded runnable Host scaffold-replacement claim", () => {
  const record = publishRunnableHostValidation(passingInput());
  assert.equal(record.verdict, "passed");
  assert.equal(record.claim, "runnable-host-scaffold-replacement");
  assert.deepEqual(record.excludes, [
    "installer-readiness", "signed-distribution", "daily-driver-completion", "full-v1-promotion",
  ]);

  assert.throws(
    () => publishRunnableHostValidation({
      ...passingInput(),
      evidence: passingInput().evidence.map(item => item.gate === "windows-vm" ? { ...item, status: "stale" as const } : item),
    }),
    /windows-vm:stale/,
  );
  assert.throws(
    () => publishRunnableHostValidation({
      ...passingInput(),
      retiredScaffolds: { ...passingInput().retiredScaffolds, lanCli: "reachable" as const },
    }),
    /lanCli:reachable/,
  );
});
