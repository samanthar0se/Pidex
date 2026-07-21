import type { DiagnosticsPort } from "./ports.js";

export function createDiagnosticsPort(
  writeDiagnosticEvent: (event: unknown) => unknown,
): DiagnosticsPort {
  return {
    async writeEvent(input): Promise<boolean> {
      try {
        return (await writeDiagnosticEvent(input)) === true;
      } catch {
        // Event Log is a best-effort projection. Structured Pidex diagnostics
        // remain authoritative and must not inherit this failure.
        return false;
      }
    },
  };
}
