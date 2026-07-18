import { randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

export type DiagnosticArea =
  | "versions"
  | "circuitBreaker"
  | "database"
  | "certificates"
  | "network"
  | "firewall"
  | "mdns"
  | "update"
  | "workers"
  | "storage";

export interface DiagnosticResult {
  ok: boolean;
  cause?: string;
  action?: string;
}

export type DiagnosticProbes = Record<
  DiagnosticArea,
  () => DiagnosticResult | Promise<DiagnosticResult>
>;

interface DiagnosticCheck extends DiagnosticResult {
  area: DiagnosticArea;
}

export interface DoctorReport {
  state: "healthy" | "degraded";
  progress: number;
  checks: DiagnosticCheck[];
}

interface DiagnosticCenterOptions {
  root: string;
  probes: DiagnosticProbes;
  maximumBytes?: number;
}

interface SupportExportInput {
  includeContent: boolean;
  contentFiles?: string[];
}

interface SupportExport {
  path: string;
  bytes: number;
}

interface DiagnosticLogEvent {
  area: string;
  cause: string;
  detail?: string;
  [key: string]: unknown;
}

type LaunchPurpose = "setup" | "recovery";

interface LaunchCapability {
  purpose: LaunchPurpose;
  expiresAt: number;
}

const DIAGNOSTIC_AREAS: DiagnosticArea[] = [
  "versions",
  "circuitBreaker",
  "database",
  "certificates",
  "network",
  "firewall",
  "mdns",
  "update",
  "workers",
  "storage",
];
const DEFAULT_MAXIMUM_BYTES = 1024 ** 3;
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1"];
const SENSITIVE_FIELD_PATTERN =
  /secret|token|password|prompt|conversation|tool|payload|output|path/i;
const SENSITIVE_PATH_PATTERN = /(?:[A-Za-z]:\\|\/)[^\s"]+/g;

/** A single source of typed operational facts for CLI, Recovery and PWA adapters. */
export class DiagnosticCenter {
  // Evidence stays local because this class deliberately has no sender.
  readonly outboundTransmissions = 0;

  constructor(readonly options: DiagnosticCenterOptions) {}

  async doctor(): Promise<DoctorReport> {
    const checks: DiagnosticCheck[] = [];

    for (const area of DIAGNOSTIC_AREAS) {
      try {
        const result = await this.options.probes[area]();
        checks.push({ area, ...result });
      } catch (error) {
        checks.push({
          area,
          ok: false,
          cause: "probe-failed",
          action: safeError(error),
        });
      }
    }

    return {
      state: checks.every(check => check.ok) ? "healthy" : "degraded",
      progress: 1,
      checks,
    };
  }

  async exportSupport(input: SupportExportInput): Promise<SupportExport> {
    mkdirSync(this.options.root, { recursive: true });

    const report = await this.doctor();
    const diagnostics = diagnosticFiles(this.options.root).map(filePath => ({
      name: basename(filePath),
      text: redact(readFileSync(filePath, "utf8")),
    }));
    const content = input.includeContent
      ? (input.contentFiles ?? []).map(filePath => ({
          name: basename(filePath),
          text: readFileSync(filePath, "utf8"),
        }))
      : [];

    const bundlePath = join(
      this.options.root,
      `support-${randomUUID()}.pidex-support`,
    );
    const bundleBytes = Buffer.from(JSON.stringify({
      format: "pidex-support-v1",
      automaticUpload: false,
      report,
      diagnostics,
      content,
    }));
    const maximumBytes = this.options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
    if (bundleBytes.length > maximumBytes) {
      throw new Error("support-evidence-exceeds-diagnostic-bound");
    }

    writeFileSync(bundlePath, bundleBytes);
    enforceAggregateBound(this.options.root, maximumBytes, [bundlePath]);
    return { path: bundlePath, bytes: statSync(bundlePath).size };
  }
}

/** Allowlisted JSONL logging: unknown fields (including prompts/tool data) never enter logs. */
export class StructuredDiagnosticLog {
  readonly path: string;
  readonly maximumBytes: number;

  constructor(readonly root: string, options: { maximumBytes?: number } = {}) {
    mkdirSync(root, { recursive: true });
    this.path = join(root, "diagnostics.jsonl");
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  }

  write(event: DiagnosticLogEvent): void {
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      area: event.area,
      cause: event.cause,
      detail: event.detail?.slice(0, 2000),
    });
    appendFileSync(this.path, `${entry}\n`);
    enforceAggregateBound(this.root, this.maximumBytes);
  }
}

export class LocalLaunchCapabilities {
  readonly #tokens = new Map<string, LaunchCapability>();

  constructor(readonly now = Date.now) {}

  issue(purpose: LaunchPurpose, lifetimeSeconds = 60): string {
    const token = randomBytes(32).toString("base64url");
    this.#tokens.set(token, {
      purpose,
      expiresAt: this.now() + lifetimeSeconds * 1000,
    });
    return token;
  }

  consume(token: string, purpose: LaunchPurpose, hostname: string): boolean {
    const capability = this.#tokens.get(token);
    this.#tokens.delete(token);

    return (
      capability !== undefined &&
      capability.purpose === purpose &&
      capability.expiresAt >= this.now() &&
      LOOPBACK_HOSTNAMES.includes(hostname)
    );
  }
}

function diagnosticFiles(root: string): string[] {
  return readdirSync(root)
    .filter(name => /^(diagnostics.*\.jsonl|crash.*\.json)$/.test(name))
    .map(name => join(root, name));
}

function redact(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(redactValue(parsed));
  } catch {
    return value
      .split("\n")
      .filter(Boolean)
      .map(redactJsonLine)
      .join("\n");
  }
}

function redactJsonLine(line: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(line)));
  } catch {
    return "";
  }
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (typeof value === "string") {
    return value.replace(SENSITIVE_PATH_PATTERN, "[PATH]");
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_FIELD_PATTERN.test(key))
      .map(([key, item]) => [key, redactValue(item)]),
  );
}

function enforceAggregateBound(
  root: string,
  maximum: number,
  protect: string[] = [],
): void {
  const protectedPaths = new Set(protect);
  const files = diagnosticFiles(root)
    .filter(path => !protectedPaths.has(path))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);
  let totalBytes = [...files, ...protect]
    .filter(path => existsSync(path))
    .reduce((sum, path) => sum + statSync(path).size, 0);

  for (const path of files) {
    if (totalBytes <= maximum) {
      break;
    }

    const fileBytes = statSync(path).size;
    unlinkSync(path);
    totalBytes -= fileBytes;
  }

  // A hot log may itself exceed the aggregate allowance; retain only its
  // newest bounded bytes.
  if (protect.length > 0) {
    return;
  }

  for (const path of diagnosticFiles(root)) {
    if (statSync(path).size <= maximum) {
      continue;
    }

    const bytes = readFileSync(path);
    const stagingPath = `${path}.rotate`;
    writeFileSync(stagingPath, bytes.subarray(bytes.length - maximum));
    renameSync(stagingPath, path);
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.name : "unknown-error";
}
