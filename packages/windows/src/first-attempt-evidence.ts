import type { ElevatedWindowsVmEvidence } from "./elevated-vm-evidence.js";

/** In-memory policy boundary; durable callers persist the returned first record. */
export class FirstAttemptEvidence {
  private readonly attempts = new Map<string, ElevatedWindowsVmEvidence>();

  record(evidence: ElevatedWindowsVmEvidence): void {
    if (!this.attempts.has(evidence.candidate)) {
      this.attempts.set(evidence.candidate, evidence);
    }
  }

  authoritative(candidate: string): ElevatedWindowsVmEvidence | undefined {
    return this.attempts.get(candidate);
  }
}
