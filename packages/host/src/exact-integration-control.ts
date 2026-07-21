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
  createPairing(): Promise<{ readonly secret: string; readonly expiresAt: number }>;
  revokeDevice(deviceId: string): Promise<void>;
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

export interface PairingSecretOutput {
  readonly channel: "interactive-console" | "inherited-secret-handle";
  writeSecret(secret: string): Promise<void>;
}

/** Routes each operation directly to the selected instance's exact policy owner. */
export class ExactIntegrationControl {
  constructor(private readonly selected: ExactIntegrationOwnerState) {}

  async pair(output: PairingSecretOutput): Promise<{ readonly expiresAt: number }> {
    this.requireLiveAuthority();
    if (output.channel !== "interactive-console" && output.channel !== "inherited-secret-handle") {
      throw new Error("pairing requires an approved pairing output channel");
    }
    const pairing = await this.selected.owner.createPairing();
    await output.writeSecret(pairing.secret);
    return { expiresAt: pairing.expiresAt };
  }

  async revoke(deviceId: string): Promise<void> {
    this.requireLiveAuthority();
    if (!deviceId) throw new Error("device identity is required");
    await this.selected.owner.revokeDevice(deviceId);
  }

  inspect(target: ExactIntegrationTarget): Promise<IntegrationInspectionResult> {
    switch (target) {
      case "origin": return this.selected.owner.inspectOrigin();
      case "certificate": return this.selected.owner.inspectCertificate();
      case "private-network": return this.selected.owner.inspectPrivateNetwork();
      case "firewall": return this.selected.owner.inspectFirewall();
    }
  }

  repair(target: ExactIntegrationTarget): Promise<IntegrationRepairResult> {
    switch (target) {
      case "origin": return this.selected.owner.repairOrigin();
      case "certificate": return this.selected.owner.repairCertificate();
      case "private-network": return this.selected.owner.repairPrivateNetwork();
      case "firewall": return this.selected.owner.repairFirewall();
    }
  }

  private requireLiveAuthority(): void {
    if (this.selected.state !== "live") {
      throw new Error("operation requires live Host authority");
    }
  }
}
