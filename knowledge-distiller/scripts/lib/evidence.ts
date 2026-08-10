import { createHash } from "node:crypto";
import * as fs from "node:fs";

export const EVIDENCE_SCHEMA_VERSION = "knowledge-distiller.evidence.v1";
export const CHECKER_VERSION = "0.1.0";

export type Gate = "passed" | "failed" | "unavailable";
export type Severity = "error" | "warning" | "info";

export type Finding = {
  code: string;
  severity: Severity;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  evidence?: Record<string, unknown>;
};

export type Evidence = {
  schema_version: string;
  checker: string;
  checker_version: string;
  generated_at: string;
  gate: Gate;
  input: Record<string, unknown>;
  metrics: Record<string, unknown>;
  findings: Finding[];
  checks?: Record<string, Evidence | Record<string, unknown>>;
};

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fileHash(file: string): string {
  return sha256(fs.readFileSync(file));
}

export function finding(
  code: string,
  severity: Severity,
  message: string,
  details: Partial<Omit<Finding, "code" | "severity" | "message">> = {}
): Finding {
  return { code, message, severity, ...details };
}

export function evidence(
  checker: string,
  gate: Gate,
  input: Record<string, unknown>,
  metrics: Record<string, unknown>,
  findings: Finding[] = [],
  checks?: Record<string, Evidence | Record<string, unknown>>
): Evidence {
  return {
    checker,
    checker_version: CHECKER_VERSION,
    findings,
    gate,
    generated_at: new Date().toISOString(),
    input,
    metrics,
    schema_version: EVIDENCE_SCHEMA_VERSION,
    ...(checks ? { checks } : {}),
  };
}

export function printEvidence(
  result: Evidence,
  json: boolean,
  human: string
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(human);
  }
}

export function exitForGate(gate: Gate): number {
  if (gate === "passed") {
    return 0;
  }
  if (gate === "failed") {
    return 1;
  }
  return 2;
}

export function runMain(main: () => number): void {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`);
    process.exitCode = 2;
  }
}

export function readJsonInput(input: string): unknown {
  return JSON.parse(
    input === "-"
      ? fs.readFileSync(0, "utf-8")
      : fs.readFileSync(input, "utf-8")
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
