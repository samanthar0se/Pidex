import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_INVARIANTS,
  DeterministicFaultCampaign,
  FAULT_BOUNDARIES,
  FAULT_PHASES,
  FAULT_SCENARIOS,
  RECOVERY_DRILLS,
} from "../packages/host/src/fault-campaign.js";

const PASSING_INVARIANTS = Object.fromEntries(
  CAMPAIGN_INVARIANTS.map(name => [name, true]),
);
const PASSING_OBSERVATION = {
  deterministic: true,
  passed: true,
  invariants: PASSING_INVARIANTS,
};

function recordCompletePassingCampaign(
  campaign: DeterministicFaultCampaign,
): void {
  for (const boundary of FAULT_BOUNDARIES) {
    for (const phase of FAULT_PHASES) {
      campaign.record({
        ...PASSING_OBSERVATION,
        id: `${boundary}-${phase}`,
        kind: "boundary",
        boundary,
        phase,
      });
    }
  }

  for (const scenarios of Object.values(FAULT_SCENARIOS)) {
    for (const scenario of scenarios) {
      campaign.record({
        ...PASSING_OBSERVATION,
        id: scenario,
        kind: "scenario",
        scenario,
      });
    }
  }

  for (const recovery of RECOVERY_DRILLS) {
    campaign.record({
      ...PASSING_OBSERVATION,
      id: recovery,
      kind: "recovery",
      recovery,
    });
  }
}

test("complete deterministic campaign covers every fault boundary, scenario, drill and invariant", () => {
  const campaign = new DeterministicFaultCampaign("sha256:release");
  recordCompletePassingCampaign(campaign);
  const evidence = campaign.evaluate();
  assert.equal(evidence.passed, true);
  assert.deepEqual(evidence.missing, []);
});

test("blocking failures fail closed and a diagnostic retry cannot turn them green", () => {
  const campaign = new DeterministicFaultCampaign("sha256:release");
  recordCompletePassingCampaign(campaign);
  campaign.record({
    ...PASSING_OBSERVATION,
    id: "failed-first",
    kind: "scenario",
    scenario: "power-loss",
    attempt: 1,
    passed: false,
  });
  campaign.record({
    ...PASSING_OBSERVATION,
    id: "diagnostic-retry",
    kind: "scenario",
    scenario: "power-loss",
    attempt: 2,
    diagnostics: "trace gathered",
  });
  const evidence = campaign.evaluate();
  assert.equal(evidence.passed, false);
  assert.ok(evidence.failures.includes("scenario:power-loss:failed"));
});

test("missing, non-deterministic, and incomplete observations block release", () => {
  const campaign = new DeterministicFaultCampaign("sha256:release");
  campaign.record({
    ...PASSING_OBSERVATION,
    id: "non-deterministic",
    kind: "scenario",
    scenario: "power-loss",
    deterministic: false,
    invariants: { "single-host-authority": true },
  });

  const evidence = campaign.evaluate();

  assert.equal(evidence.passed, false);
  assert.ok(evidence.missing.includes("boundary:command-acceptance:before"));
  assert.ok(
    evidence.failures.includes("scenario:power-loss:non-deterministic"),
  );
  assert.ok(
    evidence.failures.includes(
      "scenario:power-loss:accepted-work-has-one-ordered-outcome",
    ),
  );
});
