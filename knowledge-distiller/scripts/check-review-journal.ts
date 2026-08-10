#!/usr/bin/env node
// Validates the durable review event stream. It never infers provider health from a client timeout.

import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import {
  evidence,
  exitForGate,
  finding,
  isRecord,
  runMain,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";

const EXECUTION_STATES = new Set([
  "pending",
  "active",
  "completed",
  "failed",
  "unknown",
]);
const LIVENESS_STATES = new Set([
  "unobserved",
  "healthy",
  "suspected_stall",
  "terminal",
]);
const PARENT_STATES = new Set(["waiting", "deferred", "closed"]);
const CANCEL_STATES = new Set([
  "not_requested",
  "cancel_requested",
  "canceled_confirmed",
  "unknown",
  "superseded",
]);
const QUALITY_RESULTS = new Set([
  "clean",
  "findings",
  "unverified",
  "protocol_invalid",
  "unavailable",
]);
const QUALITY_EVENT_TYPES = new Set([
  "result",
  "review_result",
  "manual_fallback_completed",
  "manual_fallback",
  "review_completed",
]);
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  active: new Set(["active", "completed", "failed", "unknown", "deferred"]),
  cancel_requested: new Set([
    "cancel_requested",
    "canceled_confirmed",
    "unknown",
  ]),
  completed: new Set(["completed", "closed"]),
  failed: new Set(["failed", "closed"]),
  pending: new Set(["pending", "active", "failed", "unknown"]),
  suspected_stall: new Set(["suspected_stall", "cancel_requested", "deferred"]),
  unknown: new Set([
    "unknown",
    "completed",
    "failed",
    "suspected_stall",
    "deferred",
    "cancel_requested",
    "closed",
  ]),
};

function nonBlank(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0 && value.trim() !== "—";
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return value !== undefined && value !== null;
}

function present(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    (typeof value !== "string" || value.trim().length > 0)
  );
}

function requiredString(
  event: Record<string, unknown>,
  field: string,
  line: number,
  findings: Finding[]
): string {
  if (typeof event[field] !== "string" || !String(event[field]).trim()) {
    findings.push(
      finding(
        "journal-field-missing",
        "error",
        `${field} must be a non-empty string`,
        { line }
      )
    );
    return "";
  }
  return String(event[field]);
}

function readEvents(
  file: string,
  findings: Finding[]
): Record<string, unknown>[] {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    findings.push(
      finding("journal-missing", "error", "review journal does not exist", {
        path: file,
      })
    );
    return [];
  }
  const events: Record<string, unknown>[] = [];
  for (const [index, raw] of fs
    .readFileSync(file, "utf-8")
    .split(/\r?\n/u)
    .entries()) {
    if (!raw.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) {
        throw new Error("event must be an object");
      }
      events.push(parsed);
    } catch (error) {
      findings.push(
        finding(
          "journal-json-invalid",
          "error",
          `line is not a JSON object: ${(error as Error).message}`,
          { line: index + 1, path: file }
        )
      );
    }
  }
  return events;
}

type JournalIdentity = {
  axis: string;
  cycle_id: string;
  draft_hash: string;
  note_path: string;
  note_revision: number;
};

type JournalState = {
  closeIndex: number;
  cutoffOrder: number;
  eventIds: Set<string>;
  identities: Map<string, JournalIdentity>;
  previousOrder: number;
};

type EventFields = {
  attemptId: string;
  axis: string;
  cycleId: string;
  draftHash: string;
  eventType: string;
  notePath: string;
};

function validateEventAttributes(
  event: Record<string, unknown>,
  axis: string,
  draftHash: string,
  line: number,
  findings: Finding[]
): void {
  if (
    !Number.isInteger(event.note_revision) ||
    Number(event.note_revision) < 0
  ) {
    findings.push(
      finding(
        "journal-revision-invalid",
        "error",
        "note_revision must be a non-negative integer",
        { line }
      )
    );
  }
  if (draftHash && !/^[a-f0-9]{64}$/iu.test(draftHash)) {
    findings.push(
      finding(
        "journal-hash-invalid",
        "error",
        "draft_hash must be a SHA-256 hex digest",
        { line }
      )
    );
  }
  if (axis && !new Set(["clarity", "accuracy", "both", "system"]).has(axis)) {
    findings.push(
      finding("journal-axis-invalid", "error", `unsupported axis ${axis}`, {
        line,
      })
    );
  }
  if (!requiredString(event, "observed_at", line, findings)) {
    findings.push(
      finding(
        "journal-time-missing",
        "error",
        "observed_at is required for auditability",
        { line }
      )
    );
  }
  if (!requiredString(event, "observability", line, findings)) {
    findings.push(
      finding(
        "journal-observability-missing",
        "error",
        "observability is required for every event",
        { line }
      )
    );
  }
  if (event.evidence === undefined || event.evidence === null) {
    findings.push(
      finding(
        "journal-evidence-missing",
        "error",
        "evidence is required for every event",
        { line }
      )
    );
  }
  if (
    !nonBlank(event.client_dispatch_id) &&
    !nonBlank(event.provider_operation_id)
  ) {
    findings.push(
      finding(
        "journal-dispatch-identity-missing",
        "error",
        "each event needs a client_dispatch_id or provider_operation_id",
        { line }
      )
    );
  }
}

function validateEventIdentity(
  event: Record<string, unknown>,
  index: number,
  state: JournalState,
  findings: Finding[]
): EventFields {
  const line = index + 1;
  const eventId = requiredString(event, "event_id", line, findings);
  if (eventId && state.eventIds.has(eventId)) {
    findings.push(
      finding(
        "journal-event-duplicate",
        "error",
        `event_id ${eventId} is duplicated`,
        { line }
      )
    );
  }
  if (eventId) {
    state.eventIds.add(eventId);
  }
  if (
    !Number.isInteger(event.order) ||
    Number(event.order) <= state.previousOrder
  ) {
    findings.push(
      finding(
        "journal-order-invalid",
        "error",
        "order must be a strictly increasing integer",
        {
          evidence: { order: event.order, previous_order: state.previousOrder },
          line,
        }
      )
    );
  } else {
    state.previousOrder = Number(event.order);
  }

  const eventType = requiredString(event, "event_type", line, findings);
  const cycleId = requiredString(event, "cycle_id", line, findings);
  const attemptId = requiredString(event, "attempt_id", line, findings);
  const axis = requiredString(event, "axis", line, findings);
  const notePath = requiredString(event, "note_path", line, findings);
  const draftHash = requiredString(event, "draft_hash", line, findings);
  validateEventAttributes(event, axis, draftHash, line, findings);
  const identityKey = `${cycleId}\u0000${attemptId}`;
  const identity: JournalIdentity = {
    axis,
    cycle_id: cycleId,
    draft_hash: draftHash,
    note_path: notePath,
    note_revision: Number(event.note_revision),
  };
  const prior = state.identities.get(identityKey);
  if (prior && JSON.stringify(prior) !== JSON.stringify(identity)) {
    findings.push(
      finding(
        "journal-identity-drift",
        "error",
        "cycle/attempt identity changed within one attempt",
        { evidence: { current: identity, previous: prior }, line }
      )
    );
  } else if (cycleId && attemptId) {
    state.identities.set(identityKey, identity);
  }
  return { attemptId, axis, cycleId, draftHash, eventType, notePath };
}

function validateEventState(
  event: Record<string, unknown>,
  line: number,
  findings: Finding[]
): void {
  const before = String(event.state_before ?? "");
  const after = String(event.state_after ?? "");
  if (!before || !after) {
    findings.push(
      finding(
        "journal-state-missing",
        "error",
        "state_before and state_after are required",
        { line }
      )
    );
  }
  if (
    before &&
    after &&
    (!ALLOWED_TRANSITIONS[before] || !ALLOWED_TRANSITIONS[before].has(after))
  ) {
    findings.push(
      finding(
        "journal-transition-invalid",
        "error",
        `${before} → ${after} is not an allowed review transition`,
        { line }
      )
    );
  }
  for (const [field, allowed] of [
    ["provider_execution_state", EXECUTION_STATES],
    ["provider_liveness", LIVENESS_STATES],
    ["parent_wait_state", PARENT_STATES],
    ["cancel_state", CANCEL_STATES],
    ["quality_result", QUALITY_RESULTS],
  ] as const) {
    if (event[field] !== undefined && !allowed.has(String(event[field]))) {
      findings.push(
        finding(
          "journal-enum-invalid",
          "error",
          `${field} has an unsupported value`,
          { evidence: { value: event[field] }, line }
        )
      );
    }
  }
}

function requireCleanContract(
  event: Record<string, unknown>,
  axis: string,
  line: number,
  findings: Finding[]
): void {
  const labels =
    axis === "clarity" ? ["C1", "C2", "C3", "C4", "C5", "teach_back"] : ["A1"];
  const code =
    axis === "clarity"
      ? "journal-clarity-contract-missing"
      : "journal-accuracy-contract-missing";
  for (const label of labels) {
    if (!present(event[label])) {
      findings.push(
        finding(code, "error", `quality_result=clean requires ${label}`, {
          line,
        })
      );
    }
  }
}

function validateCleanEvidence(
  event: Record<string, unknown>,
  line: number,
  findings: Finding[]
): void {
  const hasFindings = Array.isArray(event.findings)
    ? event.findings.length > 0
    : nonBlank(event.findings);
  const partial =
    event.source_coverage === "partial" ||
    (Array.isArray(event.unverified) && event.unverified.length > 0) ||
    nonBlank(event.unverified);
  if (hasFindings || partial) {
    findings.push(
      finding(
        "journal-clean-contradiction",
        "error",
        "quality_result=clean contradicts findings, partial coverage, or unverified claims",
        { line }
      )
    );
  }
  if (event.source_coverage !== "complete") {
    findings.push(
      finding(
        "journal-clean-coverage-missing",
        "error",
        "quality_result=clean requires source_coverage=complete",
        { line }
      )
    );
  }
  if (
    !(typeof event.claims_checked === "number" && event.claims_checked > 0) &&
    !nonBlank(event.claims_checked)
  ) {
    findings.push(
      finding(
        "journal-clean-claims-missing",
        "error",
        "quality_result=clean requires claims_checked",
        { line }
      )
    );
  }
  if (
    !nonBlank(event.after_state) &&
    !nonBlank(event.reader_after_state) &&
    !nonBlank(event.teach_back)
  ) {
    findings.push(
      finding(
        "journal-clean-after-state-missing",
        "error",
        "quality_result=clean requires reader after-state evidence",
        { line }
      )
    );
  }
  if (
    !nonBlank(event.provider_operation_id) &&
    !nonBlank(event.client_dispatch_id)
  ) {
    findings.push(
      finding(
        "journal-clean-identity-missing",
        "error",
        "quality_result=clean requires reviewer identity evidence",
        { line }
      )
    );
  }
}

function validateCleanResult(
  event: Record<string, unknown>,
  eventType: string,
  axis: string,
  line: number,
  findings: Finding[]
): void {
  if (event.quality_result !== "clean") {
    return;
  }
  if (!QUALITY_EVENT_TYPES.has(eventType)) {
    findings.push(
      finding(
        "journal-clean-event-type-invalid",
        "error",
        "quality_result=clean must come from a result or completed fallback event",
        { line }
      )
    );
  }
  if (
    event.provider_execution_state !== "completed" ||
    event.state_after !== "completed"
  ) {
    findings.push(
      finding(
        "journal-clean-nonterminal",
        "error",
        "quality_result=clean requires provider_execution_state=completed and state_after=completed",
        { line }
      )
    );
  }
  validateCleanEvidence(event, line, findings);
  if (axis === "clarity" || axis === "accuracy") {
    requireCleanContract(event, axis, line, findings);
  }
}

function validateCloseEvent(
  event: Record<string, unknown>,
  index: number,
  state: JournalState,
  findings: Finding[]
): void {
  if (event.event_type !== "report_closed") {
    return;
  }
  const line = index + 1;
  if (state.closeIndex >= 0) {
    findings.push(
      finding(
        "journal-close-duplicate",
        "error",
        "review report may have only one report_closed event",
        { line }
      )
    );
  }
  state.closeIndex = index;
  if (Number.isInteger(event.cutoff_order)) {
    state.cutoffOrder = Number(event.cutoff_order);
  } else {
    findings.push(
      finding(
        "journal-cutoff-missing",
        "error",
        "report_closed requires an integer cutoff_order",
        { line }
      )
    );
  }
  if (event.state_after !== "closed" || event.parent_wait_state !== "closed") {
    findings.push(
      finding(
        "journal-close-state-invalid",
        "error",
        "report_closed must end in state_after=closed and parent_wait_state=closed",
        { line }
      )
    );
  }
}

function check(fileInput: string, allowOpen = false): Evidence {
  const file = path.resolve(fileInput);
  const findings: Finding[] = [];
  const events = readEvents(file, findings);
  if (events.length === 0) {
    findings.push(
      finding(
        "journal-empty",
        "error",
        "review journal must contain at least one event"
      )
    );
  }
  const state: JournalState = {
    closeIndex: -1,
    cutoffOrder: Number.POSITIVE_INFINITY,
    eventIds: new Set<string>(),
    identities: new Map<string, JournalIdentity>(),
    previousOrder: 0,
  };

  for (const [index, event] of events.entries()) {
    const { axis, eventType } = validateEventIdentity(
      event,
      index,
      state,
      findings
    );
    validateEventState(event, index + 1, findings);
    validateCleanResult(event, eventType, axis, index + 1, findings);
    validateCloseEvent(event, index, state, findings);
  }

  if (state.closeIndex >= 0) {
    if (
      !events.some(
        (event) =>
          event.event_type !== "report_closed" &&
          event.event_type !== "late_ignored"
      )
    ) {
      findings.push(
        finding(
          "journal-close-without-lifecycle",
          "error",
          "report_closed must follow at least one real lifecycle event"
        )
      );
    }
    const closeOrder = Number(events[state.closeIndex].order);
    if (state.cutoffOrder > closeOrder) {
      findings.push(
        finding(
          "journal-cutoff-invalid",
          "error",
          "cutoff_order cannot be after report_closed",
          { line: state.closeIndex + 1 }
        )
      );
    }
    for (const [index, event] of events.entries()) {
      if (
        event.quality_result === "clean" &&
        Number(event.order) > state.cutoffOrder
      ) {
        findings.push(
          finding(
            "journal-clean-after-cutoff",
            "error",
            "a clean result must be at or before report_closed.cutoff_order",
            {
              evidence: { cutoff_order: state.cutoffOrder, order: event.order },
              line: index + 1,
            }
          )
        );
      }
    }
    for (const [index, event] of events.entries()) {
      if (
        index > state.closeIndex &&
        event.event_type !== "late_ignored" &&
        event.state_after !== "late_ignored"
      ) {
        findings.push(
          finding(
            "journal-event-after-close",
            "error",
            "only late_ignored events may follow report_closed",
            { line: index + 1 }
          )
        );
      }
    }
  }
  if (events.length > 0 && state.closeIndex < 0) {
    findings.push(
      finding(
        "journal-not-closed",
        allowOpen ? "warning" : "error",
        "journal has no report_closed event yet; use --allow-open only while the lifecycle is still running"
      )
    );
  }

  const errors = findings.filter((item) => item.severity === "error");
  return evidence(
    "check-review-journal",
    errors.length === 0 ? "passed" : "failed",
    { path: file },
    {
      attempts: state.identities.size,
      closed: state.closeIndex >= 0,
      cutoff_order: Number.isFinite(state.cutoffOrder)
        ? state.cutoffOrder
        : undefined,
      events: events.length,
    },
    findings
  );
}

function selfTest(): number {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-distiller-review-journal-")
  );
  try {
    const file = path.join(root, "journal.jsonl");
    const base = {
      attempt_id: "attempt-1",
      axis: "clarity",
      cancel_state: "not_requested",
      client_dispatch_id: "dispatch-1",
      cycle_id: "cycle-1",
      draft_hash: "a".repeat(64),
      evidence: { source: "self-test" },
      note_path: "/tmp/Note.md",
      note_revision: 1,
      observability: "provider-status",
      observed_at: "2026-08-10T00:00:00Z",
      parent_wait_state: "waiting",
      provider_execution_state: "pending",
      provider_liveness: "unobserved",
      provider_operation_id: "provider-1",
      quality_result: "unavailable",
    };
    const events = [
      {
        ...base,
        event_id: "e1",
        event_type: "dispatch",
        order: 1,
        state_after: "active",
        state_before: "pending",
      },
      {
        ...base,
        C1: "—",
        C2: "—",
        C3: "—",
        C4: "—",
        C5: "—",
        after_state: "explain",
        claims_checked: 3,
        event_id: "e2",
        event_type: "result",
        findings: [],
        order: 2,
        provider_execution_state: "completed",
        provider_liveness: "terminal",
        quality_result: "clean",
        source_coverage: "complete",
        state_after: "completed",
        state_before: "active",
        teach_back: "reader can explain the model",
        unverified: "—",
      },
      {
        ...base,
        cutoff_order: 2,
        event_id: "e3",
        event_type: "report_closed",
        order: 3,
        parent_wait_state: "closed",
        state_after: "closed",
        state_before: "completed",
      },
    ];
    fs.writeFileSync(
      file,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "passed") {
      throw new Error("valid journal should pass");
    }
    fs.writeFileSync(
      file,
      `${events
        .map((event, index) =>
          JSON.stringify(
            index === 1
              ? {
                  ...event,
                  findings: ["contradiction"],
                  quality_result: "clean",
                }
              : event
          )
        )
        .join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("contradictory clean result should fail");
    }
    fs.writeFileSync(file, "", "utf-8");
    if (check(file).gate !== "failed") {
      throw new Error("empty journal should fail closed");
    }
    fs.writeFileSync(file, `${JSON.stringify({ ...events[2] })}\n`, "utf-8");
    if (check(file).gate !== "failed") {
      throw new Error("close-only journal should fail");
    }
    fs.writeFileSync(
      file,
      `${events
        .map((event, index) =>
          JSON.stringify(
            index === 0
              ? {
                  ...event,
                  C1: "—",
                  C2: "—",
                  C3: "—",
                  C4: "—",
                  C5: "—",
                  after_state: "explain",
                  claims_checked: 3,
                  event_type: "dispatch",
                  quality_result: "clean",
                  source_coverage: "complete",
                  teach_back: "reader can explain",
                }
              : event
          )
        )
        .join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("dispatch event cannot masquerade as a clean result");
    }
    fs.writeFileSync(
      file,
      `${events
        .map((event, index) => {
          if (index === 1) {
            return { ...event, order: 4 };
          }
          if (index === 2) {
            return { ...event, cutoff_order: 2, order: 5 };
          }
          return event;
        })
        .map((event) => JSON.stringify(event))
        .join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("a clean result after cutoff must fail");
    }
    console.log("review-journal checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const allowOpen = args.includes("--allow-open");
  let journal = "";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--journal") {
      i += 1;
      journal = args[i] ?? "";
    } else if (!["--json", "--allow-open", "--help", "-h"].includes(args[i])) {
      throw new Error(`unknown argument: ${args[i]}`);
    }
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: node scripts/check-review-journal.ts --journal JOURNAL.jsonl [--allow-open] [--json]"
    );
    console.log("       node scripts/check-review-journal.ts --self-test");
    return 0;
  }
  if (!journal) {
    throw new Error(
      "usage: node scripts/check-review-journal.ts --journal JOURNAL.jsonl"
    );
  }
  const result = check(journal, allowOpen);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.gate === "passed") {
    console.log("OK: review journal is identity-safe and transition-valid");
  } else {
    for (const item of result.findings.filter(
      (findingItem) => findingItem.severity === "error"
    )) {
      console.error(
        `ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`
      );
    }
  }
  return exitForGate(result.gate);
}

function runCli(): number {
  if (process.argv.includes("--self-test")) {
    return selfTest();
  }
  return main();
}

runMain(runCli);
