import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";

export type DiagnosticArea = "versions" | "circuitBreaker" | "database" | "certificates" | "network" | "firewall" | "mdns" | "update" | "workers" | "storage";
export interface DiagnosticResult { ok: boolean; cause?: string; action?: string; }
export type DiagnosticProbes = Record<DiagnosticArea, () => DiagnosticResult | Promise<DiagnosticResult>>;
export interface DoctorReport { state: "healthy" | "degraded"; progress: number; checks: Array<DiagnosticResult & { area: DiagnosticArea }>; }

const AREAS: DiagnosticArea[] = ["versions", "circuitBreaker", "database", "certificates", "network", "firewall", "mdns", "update", "workers", "storage"];
const DEFAULT_MAXIMUM_BYTES = 1024 ** 3;

/** A single source of typed operational facts for CLI, Recovery and PWA adapters. */
export class DiagnosticCenter {
  readonly outboundTransmissions = 0; // Evidence is local-only; there is deliberately no sender.
  constructor(readonly options: { root: string; probes: DiagnosticProbes; maximumBytes?: number }) {}

  async doctor(): Promise<DoctorReport> {
    const checks = [] as DoctorReport["checks"];
    for (const area of AREAS) {
      try { checks.push({ area, ...await this.options.probes[area]() }); }
      catch (error) { checks.push({ area, ok: false, cause: "probe-failed", action: safeError(error) }); }
    }
    return { state: checks.every(check => check.ok) ? "healthy" : "degraded", progress: 1, checks };
  }

  async exportSupport(input: { includeContent: boolean; contentFiles?: string[] }): Promise<{ path: string; bytes: number }> {
    mkdirSync(this.options.root, { recursive: true });
    const report = await this.doctor();
    const diagnostics = diagnosticFiles(this.options.root).map(path => ({ name: basename(path), text: redact(readFileSync(path, "utf8")) }));
    const content = input.includeContent
      ? (input.contentFiles ?? []).map(path => ({ name: basename(path), text: readFileSync(path, "utf8") }))
      : [];
    const path = join(this.options.root, `support-${randomUUID()}.pidex-support`);
    const bytes = Buffer.from(JSON.stringify({ format: "pidex-support-v1", automaticUpload: false, report, diagnostics, content }));
    if (bytes.length > (this.options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES)) throw new Error("support-evidence-exceeds-diagnostic-bound");
    writeFileSync(path, bytes);
    enforceAggregateBound(this.options.root, this.options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES, [path]);
    return { path, bytes: statSync(path).size };
  }
}

/** Allowlisted JSONL logging: unknown fields (including prompts/tool data) never enter logs. */
export class StructuredDiagnosticLog {
  readonly path: string;
  readonly maximumBytes: number;
  constructor(readonly root: string, options: { maximumBytes?: number } = {}) {
    mkdirSync(root, { recursive: true }); this.path = join(root, "diagnostics.jsonl");
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  }
  write(event: { area: string; cause: string; detail?: string; [key: string]: unknown }): void {
    appendFileSync(this.path, JSON.stringify({ at: new Date().toISOString(), area: event.area, cause: event.cause, detail: event.detail?.slice(0, 2000) }) + "\n");
    enforceAggregateBound(this.root, this.maximumBytes);
  }
}

export class LocalLaunchCapabilities {
  readonly #tokens = new Map<string, { purpose: "setup" | "recovery"; expiresAt: number }>();
  constructor(readonly now = Date.now) {}
  issue(purpose: "setup" | "recovery", lifetimeSeconds = 60): string {
    const token = randomBytes(32).toString("base64url");
    this.#tokens.set(token, { purpose, expiresAt: this.now() + lifetimeSeconds * 1000 }); return token;
  }
  consume(token: string, purpose: "setup" | "recovery", hostname: string): boolean {
    const record = this.#tokens.get(token); this.#tokens.delete(token);
    return !!record && record.purpose === purpose && record.expiresAt >= this.now() && ["localhost", "127.0.0.1", "::1"].includes(hostname);
  }
}

function diagnosticFiles(root: string): string[] {
  return readdirSync(root).filter(name => /^(diagnostics.*\.jsonl|crash.*\.json)$/.test(name)).map(name => join(root, name));
}
function redact(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(redactValue(parsed));
  } catch { return value.split("\n").filter(Boolean).map(line => { try { return JSON.stringify(redactValue(JSON.parse(line))); } catch { return ""; } }).join("\n"); }
}
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.replace(/(?:[A-Za-z]:\\|\/)[^\s"]+/g, "[PATH]") : value;
  const forbidden = /secret|token|password|prompt|conversation|tool|payload|output|path/i;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.test(key)).map(([key, item]) => [key, redactValue(item)]));
}
function enforceAggregateBound(root: string, maximum: number, protect: string[] = []): void {
  const protectedPaths = new Set(protect);
  let files = diagnosticFiles(root).filter(path => !protectedPaths.has(path)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  let total = [...files, ...protect].filter(existsSync).reduce((sum, path) => sum + statSync(path).size, 0);
  for (const path of files) { if (total <= maximum) break; const size = statSync(path).size; unlinkSync(path); total -= size; }
  // A hot log may itself exceed the aggregate allowance; retain only its newest bounded bytes.
  for (const path of protect.length ? [] : diagnosticFiles(root)) if (statSync(path).size > maximum) {
    const bytes = readFileSync(path); const stage = `${path}.rotate`; writeFileSync(stage, bytes.subarray(bytes.length - maximum)); renameSync(stage, path);
  }
}
function safeError(error: unknown): string { return error instanceof Error ? error.name : "unknown-error"; }
