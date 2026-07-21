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

  requirePassing(candidate: string): ElevatedWindowsVmEvidence {
    const evidence = this.authoritative(candidate);
    if (!evidence) {
      throw new Error("authoritative first attempt is missing");
    }
    if (evidence.status !== "passed") {
      throw new Error("authoritative first attempt did not pass");
    }
    return evidence;
  }
}
