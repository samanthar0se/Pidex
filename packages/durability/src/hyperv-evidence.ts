export type EvidenceStatus =
  | "passed"
  | "failed"
  | "missing"
  | "stale"
  | "incomplete";

type PrivacySafeValue = number | boolean | null;

export type PrivacySafeState = Readonly<Record<string, PrivacySafeValue>>;

export interface HyperVCampaignAttempt {
  schema: "pidex-hyperv-attempt-v1";
  campaignId: string;
  build: string;
  kind: "periodic" | "durability-change";
  attemptedAt: number;
  result: "passed" | "failed" | "incomplete";
  recovery: "selected" | "fail-closed" | "not-attempted";
  reconciliation: "completed" | "not-completed";
  preRecovery?: PrivacySafeState;
}

export interface CampaignRequest {
  campaignId: string;
  build: string;
  kind: HyperVCampaignAttempt["kind"];
  now: number;
}

type CampaignOutcome = Pick<
  HyperVCampaignAttempt,
  "result" | "recovery" | "reconciliation"
>;

export interface ExternallyControlledGuest {
  /** Must persist independently of the guest. Rejection prevents power-off. */
  arm(request: CampaignRequest): Promise<void>;
  hardPowerOff(): Promise<void>;
  /** Runs while the Host remains stopped and must return no paths or device identifiers. */
  capturePreRecovery(): Promise<PrivacySafeState>;
  /** The normal startup resolver, including accepted-work reconciliation. */
  recoverProduction(): Promise<"selected" | "fail-closed">;
}

export class HyperVCampaignController {
  constructor(private readonly guest: ExternallyControlledGuest) {}

  async run(request: CampaignRequest): Promise<HyperVCampaignAttempt> {
    validateRequest(request);
    // The awaited out-of-band write is the permission to remove guest power.
    await this.guest.arm({ ...request });
    await this.guest.hardPowerOff();

    let preRecovery: PrivacySafeState | undefined;
    try {
      preRecovery = sanitizeState(await this.guest.capturePreRecovery());
      const recovery = await this.guest.recoverProduction();
      const result = recovery === "selected" ? "passed" : "failed";

      return createAttempt(
        request,
        { result, recovery, reconciliation: "completed" },
        preRecovery,
      );
    } catch {
      return createAttempt(
        request,
        {
          result: "incomplete",
          recovery: "not-attempted",
          reconciliation: "not-completed",
        },
        preRecovery,
      );
    }
  }
}

export interface DeterministicModelAttempt {
  attemptedAt: number;
  result: "passed" | "failed";
  complete: boolean;
}

export interface ReleaseDurabilityArtifact {
  schema: "pidex-release-durability-v1";
  build: string;
  deterministicModel: { status: EvidenceStatus };
  hyperV: { status: EvidenceStatus; advisory: true };
  promotionEligible: boolean;
  claimBoundary: string;
}

/** Produces the durability section linked by a release artifact. */
export class ReleaseDurabilityEvidence {
  #model?: DeterministicModelAttempt;
  #hyperV?: HyperVCampaignAttempt;

  constructor(
    readonly build: string,
    private readonly publishedAt: number,
    private readonly maximumAge: number,
  ) {
    if (!build.trim() || maximumAge < 0) {
      throw new Error("invalid-release-evidence-policy");
    }
  }

  recordModel(attempt: DeterministicModelAttempt): void {
    if (!this.#model) {
      this.#model = structuredClone(attempt);
    }
  }

  recordHyperV(attempt: HyperVCampaignAttempt): void {
    if (attempt.build !== this.build) {
      throw new Error("evidence-build-mismatch");
    }

    // First authoritative attempt is immutable; later runs are diagnostics.
    if (!this.#hyperV) {
      this.#hyperV = structuredClone(attempt);
    }
  }

  publish(): ReleaseDurabilityArtifact {
    const modelStatus = statusForModel(
      this.#model,
      this.publishedAt,
      this.maximumAge,
    );
    const hyperVStatus = statusForHyperV(
      this.#hyperV,
      this.publishedAt,
      this.maximumAge,
    );

    return {
      schema: "pidex-release-durability-v1",
      build: this.build,
      deterministicModel: { status: modelStatus },
      hyperV: { status: hyperVStatus, advisory: true },
      // Model evidence gates promotion. Hyper-V evidence is deliberately absent here.
      promotionEligible: modelStatus === "passed",
      claimBoundary:
        "Advisory Hyper-V evidence is not physical-media certification and does not expand Windows-reported fixed NTFS coverage.",
    };
  }
}

function statusForModel(
  attempt: DeterministicModelAttempt | undefined,
  publishedAt: number,
  maximumAge: number,
): EvidenceStatus {
  if (!attempt) {
    return "missing";
  }
  if (!attempt.complete) {
    return "incomplete";
  }
  if (attempt.result === "failed") {
    return "failed";
  }
  if (publishedAt - attempt.attemptedAt > maximumAge) {
    return "stale";
  }

  return "passed";
}

function statusForHyperV(
  attempt: HyperVCampaignAttempt | undefined,
  publishedAt: number,
  maximumAge: number,
): EvidenceStatus {
  if (!attempt) {
    return "missing";
  }
  if (
    attempt.result === "incomplete" ||
    attempt.reconciliation !== "completed"
  ) {
    return "incomplete";
  }
  if (attempt.result === "failed") {
    return "failed";
  }
  if (publishedAt - attempt.attemptedAt > maximumAge) {
    return "stale";
  }

  return "passed";
}

function createAttempt(
  request: CampaignRequest,
  outcome: CampaignOutcome,
  preRecovery?: PrivacySafeState,
): HyperVCampaignAttempt {
  return {
    schema: "pidex-hyperv-attempt-v1",
    ...request,
    attemptedAt: request.now,
    ...outcome,
    ...(preRecovery ? { preRecovery } : {}),
  };
}

function sanitizeState(state: PrivacySafeState): PrivacySafeState {
  const safe: Record<string, PrivacySafeValue> = {};

  for (const [key, value] of Object.entries(state)) {
    const hasSafeKey = /^[a-z][a-z0-9-]{0,63}$/i.test(key);
    const hasSafeValue =
      typeof value === "number" || typeof value === "boolean" || value === null;

    if (!hasSafeKey || !hasSafeValue) {
      throw new Error("unsafe-pre-recovery-evidence");
    }

    safe[key] = value;
  }

  return safe;
}

function validateRequest(request: CampaignRequest): void {
  if (
    !request.campaignId.trim() ||
    !request.build.trim() ||
    !Number.isFinite(request.now)
  ) {
    throw new Error("invalid-hyperv-campaign");
  }
}
