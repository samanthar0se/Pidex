export type ExactIntegrationTarget =
  | "origin"
  | "certificate"
  | "private-network"
  | "firewall";

export interface IntegrationInspectionResult {
  readonly state: string;
  readonly [key: string]: unknown;
}

export interface IntegrationRepairResult {
  readonly changed: boolean;
  readonly [key: string]: unknown;
}

export interface ExactIntegrationPolicyOwner {
  inspectOrigin(): Promise<IntegrationInspectionResult>;
  repairOrigin(): Promise<IntegrationRepairResult>;
  inspectCertificate(): Promise<IntegrationInspectionResult>;
  repairCertificate(): Promise<IntegrationRepairResult>;
  inspectPrivateNetwork(): Promise<IntegrationInspectionResult>;
  repairPrivateNetwork(): Promise<IntegrationRepairResult>;
  inspectFirewall(): Promise<IntegrationInspectionResult>;
  repairFirewall(): Promise<IntegrationRepairResult>;
}

export type ExactIntegrationOwnerState =
  | { readonly state: "live"; readonly owner: ExactIntegrationPolicyOwner }
  | { readonly state: "maintenance"; readonly owner: ExactIntegrationPolicyOwner };

interface ExactIntegrationOperations {
  inspect(owner: ExactIntegrationPolicyOwner): Promise<IntegrationInspectionResult>;
  repair(owner: ExactIntegrationPolicyOwner): Promise<IntegrationRepairResult>;
}

const operationsByTarget: Record<ExactIntegrationTarget, ExactIntegrationOperations> = {
  origin: {
    inspect: owner => owner.inspectOrigin(),
    repair: owner => owner.repairOrigin(),
  },
  certificate: {
    inspect: owner => owner.inspectCertificate(),
    repair: owner => owner.repairCertificate(),
  },
  "private-network": {
    inspect: owner => owner.inspectPrivateNetwork(),
    repair: owner => owner.repairPrivateNetwork(),
  },
  firewall: {
    inspect: owner => owner.inspectFirewall(),
    repair: owner => owner.repairFirewall(),
  },
};

/** Routes each operation directly to the selected instance's exact policy owner. */
export class ExactIntegrationControl {
  constructor(private readonly selected: ExactIntegrationOwnerState) {}

  inspect(target: ExactIntegrationTarget): Promise<IntegrationInspectionResult> {
    return operationsByTarget[target].inspect(this.selected.owner);
  }

  repair(target: ExactIntegrationTarget): Promise<IntegrationRepairResult> {
    return operationsByTarget[target].repair(this.selected.owner);
  }

  private requireLiveAuthority(): void {
    if (this.selected.state !== "live") {
      throw new Error("operation requires live Host authority");
    }
  }
}
