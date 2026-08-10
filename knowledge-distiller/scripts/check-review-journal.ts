#!/usr/bin/env node
// Validates the durable review event stream. It never infers provider health from a client timeout.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { evidence, exitForGate, finding, isRecord, type Evidence, type Finding } from "./lib/evidence.ts";

const EXECUTION_STATES = new Set(["pending", "active", "completed", "failed", "unknown"]);
const LIVENESS_STATES = new Set(["unobserved", "healthy", "suspected_stall", "terminal"]);
const PARENT_STATES = new Set(["waiting", "deferred", "closed"]);
const CANCEL_STATES = new Set(["not_requested", "cancel_requested", "canceled_confirmed", "unknown", "superseded"]);
const QUALITY_RESULTS = new Set(["clean", "findings", "unverified", "protocol_invalid", "unavailable"]);
const QUALITY_EVENT_TYPES = new Set(["result", "review_result", "manual_fallback_completed", "manual_fallback", "review_completed"]);
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(["pending", "active", "failed", "unknown"]),
  active: new Set(["active", "completed", "failed", "unknown", "deferred"]),
  unknown: new Set(["unknown", "completed", "failed", "suspected_stall", "deferred", "cancel_requested", "closed"]),
  suspected_stall: new Set(["suspected_stall", "cancel_requested", "deferred"]),
  cancel_requested: new Set(["cancel_requested", "canceled_confirmed", "unknown"]),
  completed: new Set(["completed", "closed"]),
  failed: new Set(["failed", "closed"]),
};

function requiredString(event: Record<string, unknown>, field: string, line: number, findings: Finding[]): string {
  if (typeof event[field] !== "string" || !String(event[field]).trim()) {
    findings.push(finding("journal-field-missing", "error", `${field} must be a non-empty string`, { line }));
    return "";
  }
  return String(event[field]);
}

function readEvents(file: string, findings: Finding[]): Array<Record<string, unknown>> {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    findings.push(finding("journal-missing", "error", "review journal does not exist", { path: file }));
    return [];
  }
  const events: Array<Record<string, unknown>> = [];
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("event must be an object");
      events.push(parsed);
    } catch (error) {
      findings.push(finding("journal-json-invalid", "error", `line is not a JSON object: ${(error as Error).message}`, { path: file, line: index + 1 }));
    }
  });
  return events;
}

function check(fileInput: string, allowOpen = false): Evidence {
  const file = path.resolve(fileInput);
  const findings: Finding[] = [];
  const events = readEvents(file, findings);
  if (events.length === 0) findings.push(finding("journal-empty", "error", "review journal must contain at least one event"));
  const eventIds = new Set<string>();
  const identities = new Map<string, { cycle_id: string; axis: string; note_path: string; note_revision: number; draft_hash: string }>();
  let previousOrder = 0;
  let closeIndex = -1;
  let cutoffOrder = Number.POSITIVE_INFINITY;

  events.forEach((event, index) => {
    const line = index + 1;
    const eventId = requiredString(event, "event_id", line, findings);
    if (eventId && eventIds.has(eventId)) findings.push(finding("journal-event-duplicate", "error", `event_id ${eventId} is duplicated`, { line }));
    if (eventId) eventIds.add(eventId);
    if (!Number.isInteger(event.order) || Number(event.order) <= previousOrder) findings.push(finding("journal-order-invalid", "error", "order must be a strictly increasing integer", { line, evidence: { previous_order: previousOrder, order: event.order } }));
    else previousOrder = Number(event.order);

    const eventType = requiredString(event, "event_type", line, findings);
    const cycleId = requiredString(event, "cycle_id", line, findings);
    const attemptId = requiredString(event, "attempt_id", line, findings);
    const axis = requiredString(event, "axis", line, findings);
    const notePath = requiredString(event, "note_path", line, findings);
    const draftHash = requiredString(event, "draft_hash", line, findings);
    if (!Number.isInteger(event.note_revision) || Number(event.note_revision) < 0) findings.push(finding("journal-revision-invalid", "error", "note_revision must be a non-negative integer", { line }));
    if (draftHash && !/^[a-f0-9]{64}$/i.test(draftHash)) findings.push(finding("journal-hash-invalid", "error", "draft_hash must be a SHA-256 hex digest", { line }));
    if (axis && !new Set(["clarity", "accuracy", "both", "system"]).has(axis)) findings.push(finding("journal-axis-invalid", "error", `unsupported axis ${axis}`, { line }));
    if (!requiredString(event, "observed_at", line, findings)) findings.push(finding("journal-time-missing", "error", "observed_at is required for auditability", { line }));
    if (!requiredString(event, "observability", line, findings)) findings.push(finding("journal-observability-missing", "error", "observability is required for every event", { line }));
    if (event.evidence === undefined || event.evidence === null) findings.push(finding("journal-evidence-missing", "error", "evidence is required for every event", { line }));
    if (!nonBlank(event.client_dispatch_id) && !nonBlank(event.provider_operation_id)) findings.push(finding("journal-dispatch-identity-missing", "error", "each event needs a client_dispatch_id or provider_operation_id", { line }));

    const identityKey = `${cycleId}\u0000${attemptId}`;
    const identity = { cycle_id: cycleId, axis, note_path: notePath, note_revision: Number(event.note_revision), draft_hash: draftHash };
    const prior = identities.get(identityKey);
    if (prior && JSON.stringify(prior) !== JSON.stringify(identity)) findings.push(finding("journal-identity-drift", "error", "cycle/attempt identity changed within one attempt", { line, evidence: { previous: prior, current: identity } }));
    else if (cycleId && attemptId) identities.set(identityKey, identity);

    const before = String(event.state_before ?? "");
    const after = String(event.state_after ?? "");
    if (!before || !after) findings.push(finding("journal-state-missing", "error", "state_before and state_after are required", { line }));
    if (before && after && (!ALLOWED_TRANSITIONS[before] || !ALLOWED_TRANSITIONS[before].has(after))) findings.push(finding("journal-transition-invalid", "error", `${before} → ${after} is not an allowed review transition`, { line }));

    for (const [field, allowed] of [["provider_execution_state", EXECUTION_STATES], ["provider_liveness", LIVENESS_STATES], ["parent_wait_state", PARENT_STATES], ["cancel_state", CANCEL_STATES], ["quality_result", QUALITY_RESULTS]] as const) {
      if (event[field] !== undefined && !allowed.has(String(event[field]))) findings.push(finding("journal-enum-invalid", "error", `${field} has an unsupported value`, { line, evidence: { value: event[field] } }));
    }
    if (event.quality_result === "clean") {
      if (!QUALITY_EVENT_TYPES.has(eventType)) findings.push(finding("journal-clean-event-type-invalid", "error", "quality_result=clean must come from a result or completed fallback event", { line }));
      if (event.provider_execution_state !== "completed" || event.state_after !== "completed") findings.push(finding("journal-clean-nonterminal", "error", "quality_result=clean requires provider_execution_state=completed and state_after=completed", { line }));
      const hasFindings = Array.isArray(event.findings) ? event.findings.length > 0 : nonBlank(event.findings);
      const partial = event.source_coverage === "partial" || (Array.isArray(event.unverified) && event.unverified.length > 0) || nonBlank(event.unverified);
      if (hasFindings || partial) findings.push(finding("journal-clean-contradiction", "error", "quality_result=clean contradicts findings, partial coverage, or unverified claims", { line }));
      if (event.source_coverage !== "complete") findings.push(finding("journal-clean-coverage-missing", "error", "quality_result=clean requires source_coverage=complete", { line }));
      if (!(typeof event.claims_checked === "number" && event.claims_checked > 0) && !nonBlank(event.claims_checked)) findings.push(finding("journal-clean-claims-missing", "error", "quality_result=clean requires claims_checked", { line }));
      if (!nonBlank(event.after_state) && !nonBlank(event.reader_after_state) && !nonBlank(event.teach_back)) findings.push(finding("journal-clean-after-state-missing", "error", "quality_result=clean requires reader after-state evidence", { line }));
      if (!nonBlank(event.provider_operation_id) && !nonBlank(event.client_dispatch_id)) findings.push(finding("journal-clean-identity-missing", "error", "quality_result=clean requires reviewer identity evidence", { line }));
      if (axis === "clarity") {
        for (const label of ["C1", "C2", "C3", "C4", "C5", "teach_back"]) if (!present(event[label])) findings.push(finding("journal-clarity-contract-missing", "error", `quality_result=clean requires ${label}`, { line }));
      }
      if (axis === "accuracy") {
        for (const label of ["A1"]) if (!present(event[label])) findings.push(finding("journal-accuracy-contract-missing", "error", `quality_result=clean requires ${label}`, { line }));
      }
    }
    if (eventType === "report_closed") {
      if (closeIndex >= 0) findings.push(finding("journal-close-duplicate", "error", "review report may have only one report_closed event", { line }));
      closeIndex = index;
      if (!Number.isInteger(event.cutoff_order)) findings.push(finding("journal-cutoff-missing", "error", "report_closed requires an integer cutoff_order", { line }));
      else cutoffOrder = Number(event.cutoff_order);
      if (event.state_after !== "closed" || event.parent_wait_state !== "closed") findings.push(finding("journal-close-state-invalid", "error", "report_closed must end in state_after=closed and parent_wait_state=closed", { line }));
    }
  });

  if (closeIndex >= 0) {
    if (!events.some((event) => event.event_type !== "report_closed" && event.event_type !== "late_ignored")) findings.push(finding("journal-close-without-lifecycle", "error", "report_closed must follow at least one real lifecycle event"));
    const closeOrder = Number(events[closeIndex].order);
    if (cutoffOrder > closeOrder) findings.push(finding("journal-cutoff-invalid", "error", "cutoff_order cannot be after report_closed", { line: closeIndex + 1 }));
    events.forEach((event, index) => {
      if (event.quality_result === "clean" && Number(event.order) > cutoffOrder) findings.push(finding("journal-clean-after-cutoff", "error", "a clean result must be at or before report_closed.cutoff_order", { line: index + 1, evidence: { order: event.order, cutoff_order: cutoffOrder } }));
    });
    events.forEach((event, index) => {
      if (index > closeIndex && event.event_type !== "late_ignored" && event.state_after !== "late_ignored") findings.push(finding("journal-event-after-close", "error", "only late_ignored events may follow report_closed", { line: index + 1 }));
    });
  }
  if (events.length > 0 && closeIndex < 0) findings.push(finding("journal-not-closed", allowOpen ? "warning" : "error", "journal has no report_closed event yet; use --allow-open only while the lifecycle is still running"));

  const errors = findings.filter((item) => item.severity === "error");
  return evidence("check-review-journal", errors.length === 0 ? "passed" : "failed", { path: file }, {
    events: events.length,
    attempts: identities.size,
    closed: closeIndex >= 0,
    cutoff_order: Number.isFinite(cutoffOrder) ? cutoffOrder : undefined,
  }, findings);
}

function nonBlank(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0 && value.trim() !== "—";
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && (typeof value !== "string" || value.trim().length > 0);
}

function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-review-journal-"));
  try {
    const file = path.join(root, "journal.jsonl");
    const base = { cycle_id: "cycle-1", attempt_id: "attempt-1", axis: "clarity", note_path: "/tmp/Note.md", note_revision: 1, draft_hash: "a".repeat(64), client_dispatch_id: "dispatch-1", provider_operation_id: "provider-1", observed_at: "2026-08-10T00:00:00Z", observability: "provider-status", evidence: { source: "self-test" }, provider_execution_state: "pending", provider_liveness: "unobserved", parent_wait_state: "waiting", cancel_state: "not_requested", quality_result: "unavailable" };
    const events = [
      { ...base, event_id: "e1", order: 1, event_type: "dispatch", state_before: "pending", state_after: "active" },
      { ...base, event_id: "e2", order: 2, event_type: "result", state_before: "active", state_after: "completed", provider_execution_state: "completed", provider_liveness: "terminal", quality_result: "clean", findings: [], source_coverage: "complete", claims_checked: 3, after_state: "explain", teach_back: "reader can explain the model", C1: "—", C2: "—", C3: "—", C4: "—", C5: "—", unverified: "—" },
      { ...base, event_id: "e3", order: 3, event_type: "report_closed", state_before: "completed", state_after: "closed", parent_wait_state: "closed", cutoff_order: 2 },
    ];
    fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
    if (check(file).gate !== "passed") throw new Error("valid journal should pass");
    fs.writeFileSync(file, events.map((event, index) => JSON.stringify(index === 1 ? { ...event, quality_result: "clean", findings: ["contradiction"] } : event)).join("\n") + "\n", "utf8");
    if (check(file).gate !== "failed") throw new Error("contradictory clean result should fail");
    fs.writeFileSync(file, "", "utf8");
    if (check(file).gate !== "failed") throw new Error("empty journal should fail closed");
    fs.writeFileSync(file, JSON.stringify({ ...events[2] }) + "\n", "utf8");
    if (check(file).gate !== "failed") throw new Error("close-only journal should fail");
    fs.writeFileSync(file, events.map((event, index) => JSON.stringify(index === 0 ? { ...event, event_type: "dispatch", quality_result: "clean", source_coverage: "complete", claims_checked: 3, after_state: "explain", teach_back: "reader can explain", C1: "—", C2: "—", C3: "—", C4: "—", C5: "—" } : event)).join("\n") + "\n", "utf8");
    if (check(file).gate !== "failed") throw new Error("dispatch event cannot masquerade as a clean result");
    fs.writeFileSync(file, events.map((event, index) => JSON.stringify(index === 1 ? { ...event, order: 4 } : index === 2 ? { ...event, order: 5, cutoff_order: 2 } : event)).join("\n") + "\n", "utf8");
    if (check(file).gate !== "failed") throw new Error("a clean result after cutoff must fail");
    console.log("review-journal checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const json = args.includes("--json");
  const allowOpen = args.includes("--allow-open");
  let journal = "";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--journal") journal = args[++i] ?? "";
    else if (!["--json", "--allow-open", "--help", "-h"].includes(args[i])) throw new Error(`unknown argument: ${args[i]}`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/check-review-journal.ts --journal JOURNAL.jsonl [--allow-open] [--json]");
    console.log("       node scripts/check-review-journal.ts --self-test");
    return 0;
  }
  if (!journal) throw new Error("usage: node scripts/check-review-journal.ts --journal JOURNAL.jsonl");
  const result = check(journal, allowOpen);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.gate === "passed") console.log("OK: review journal is identity-safe and transition-valid");
  else result.findings.filter((item) => item.severity === "error").forEach((item) => console.error(`ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`));
  return exitForGate(result.gate);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
