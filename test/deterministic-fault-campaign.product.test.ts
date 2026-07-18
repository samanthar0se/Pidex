import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_INVARIANTS, DeterministicFaultCampaign, FAULT_BOUNDARIES,
  FAULT_PHASES, FAULT_SCENARIOS, RECOVERY_DRILLS,
  type FaultObservation,
} from "../packages/host/src/fault-campaign.js";

const invariants = Object.fromEntries(CAMPAIGN_INVARIANTS.map(name => [name, true]));
const base = { deterministic: true, passed: true, invariants };

function complete(campaign: DeterministicFaultCampaign): void {
  for (const boundary of FAULT_BOUNDARIES) for (const phase of FAULT_PHASES)
    campaign.record({ ...base, id: `${boundary}-${phase}`, kind: "boundary", boundary, phase });
  for (const scenarios of Object.values(FAULT_SCENARIOS)) for (const scenario of scenarios)
    campaign.record({ ...base, id: scenario, kind: "scenario", scenario } as FaultObservation);
  for (const recovery of RECOVERY_DRILLS)
    campaign.record({ ...base, id: recovery, kind: "recovery", recovery });
}

test("complete deterministic campaign covers every fault boundary, scenario, drill and invariant", () => {
  const campaign = new DeterministicFaultCampaign("sha256:release");
  complete(campaign);
  const evidence = campaign.evaluate();
  assert.equal(evidence.passed, true);
  assert.deepEqual(evidence.missing, []);
});

test("blocking failures fail closed and a diagnostic retry cannot turn them green", () => {
  const campaign = new DeterministicFaultCampaign("sha256:release");
  complete(campaign);
  campaign.record({ ...base, id: "failed-first", kind: "scenario", scenario: "power-loss", attempt: 0 + 1, passed: false });
  campaign.record({ ...base, id: "diagnostic-retry", kind: "scenario", scenario: "power-loss", attempt: 2, diagnostics: "trace gathered" });
  const evidence = campaign.evaluate();
  assert.equal(evidence.passed, false);
  assert.ok(evidence.failures.includes("scenario:power-loss:failed"));
});
