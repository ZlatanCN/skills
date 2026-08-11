#!/usr/bin/env node
// Validates the review event stream without treating observation as lifecycle state.

import * as fs from "node:fs";
import path from "node:path";

import {
  evidence,
  exitForGate,
  finding,
  isRecord,
  runMain,
  withTempDir,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";

const ATTEMPT_STATES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "stopped",
]);
const RESULTS = new Set(["clean", "findings", "unverified"]);
const OBSERVABILITY = new Set(["observed", "silent", "lost"]);
const AXES = new Set(["clarity", "accuracy"]);
const EVENT_TYPES = new Set([
  "dispatch",
  "progress",
  "poll",
  "result",
  "failure",
  "stop_requested",
  "stop_confirmed",
  "manual_fallback",
  "late_ignored",
  "report_closed",
]);
const TRANSITIONS: Record<string, Set<string>> = {
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  pending: new Set(["pending", "running", "failed", "stopped"]),
  running: new Set(["running", "completed", "failed", "stopped"]),
  stopped: new Set(["stopped"]),
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
          {
            line: index + 1,
            path: file,
          }
        )
      );
    }
  }
  return events;
}

type Identity = {
  run_id: string;
  axis: string;
  cycle_id: string;
  draft_hash: string;
  note_path: string;
  note_revision: number;
  event_type: string;
};

type JournalState = {
  runId: string | undefined;
  closeIndex: number;
  closeOrder: number;
  eventIds: Set<string>;
  identities: Map<string, Identity>;
  previousOrder: number;
  attemptStates: Map<string, string>;
};

function validateCommon(
  event: Record<string, unknown>,
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
  if (
    typeof event.draft_hash !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(event.draft_hash)
  ) {
    findings.push(
      finding(
        "journal-hash-invalid",
        "error",
        "draft_hash must be a SHA-256 hex digest",
        { line }
      )
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
  if (!OBSERVABILITY.has(String(event.observability))) {
    findings.push(
      finding(
        "journal-observability-invalid",
        "error",
        "observability must be observed, silent, or lost",
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
}

function validateEventOrder(
  event: Record<string, unknown>,
  index: number,
  state: JournalState,
  findings: Finding[]
): string {
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
        { line }
      )
    );
  } else {
    state.previousOrder = Number(event.order);
  }
  return eventId;
}

function validateEventShape(
  event: Record<string, unknown>,
  eventType: string,
  attemptId: string,
  axis: string,
  line: number,
  findings: Finding[]
): void {
  if (!EVENT_TYPES.has(eventType)) {
    findings.push(
      finding(
        "journal-event-type-invalid",
        "error",
        `unsupported event_type ${eventType}`,
        { line }
      )
    );
  }
  if (
    eventType === "report_closed" &&
    (axis !== "system" || attemptId !== "run")
  ) {
    findings.push(
      finding(
        "journal-close-identity-invalid",
        "error",
        "report_closed must use axis=system and attempt_id=run",
        { line }
      )
    );
  }
  if (eventType !== "report_closed" && !AXES.has(axis)) {
    findings.push(
      finding("journal-axis-invalid", "error", `unsupported axis ${axis}`, {
        line,
      })
    );
  }
  if (
    !["report_closed", "manual_fallback"].includes(eventType) &&
    !nonBlank(event.client_dispatch_id) &&
    !nonBlank(event.provider_operation_id)
  ) {
    findings.push(
      finding(
        "journal-dispatch-identity-missing",
        "error",
        "attempt events need a client_dispatch_id or provider_operation_id",
        { line }
      )
    );
  }
  if (eventType === "manual_fallback" && !nonBlank(event.fallback_id)) {
    findings.push(
      finding(
        "journal-fallback-identity-missing",
        "error",
        "manual_fallback requires fallback_id",
        { line }
      )
    );
  }
}

function recordAttemptIdentity(
  event: Record<string, unknown>,
  eventType: string,
  runId: string,
  cycleId: string,
  attemptId: string,
  axis: string,
  notePath: string,
  draftHash: string,
  state: JournalState,
  line: number,
  findings: Finding[]
): string {
  const key = `${cycleId}\u0000${attemptId}`;
  if (eventType === "report_closed") {
    return key;
  }
  const identity: Identity = {
    axis,
    cycle_id: cycleId,
    draft_hash: draftHash,
    event_type: eventType,
    note_path: notePath,
    note_revision: Number(event.note_revision),
    run_id: runId,
  };
  const prior = state.identities.get(key);
  const stableIdentity = prior
    ? { ...identity, event_type: prior.event_type }
    : identity;
  if (prior && JSON.stringify(prior) !== JSON.stringify(stableIdentity)) {
    findings.push(
      finding(
        "journal-identity-drift",
        "error",
        "cycle/attempt identity changed within one attempt",
        { line }
      )
    );
  } else if (cycleId && attemptId) {
    state.identities.set(key, stableIdentity);
  }
  return key;
}

function validateIdentity(
  event: Record<string, unknown>,
  index: number,
  state: JournalState,
  findings: Finding[]
): { key: string; eventType: string; axis: string } {
  const line = index + 1;
  validateEventOrder(event, index, state, findings);

  const eventType = requiredString(event, "event_type", line, findings);
  const runId = requiredString(event, "run_id", line, findings);
  const cycleId = requiredString(event, "cycle_id", line, findings);
  const attemptId = requiredString(event, "attempt_id", line, findings);
  const axis = requiredString(event, "axis", line, findings);
  const notePath = requiredString(event, "note_path", line, findings);
  const draftHash = requiredString(event, "draft_hash", line, findings);
  validateCommon(event, line, findings);

  if (runId) {
    if (state.runId && state.runId !== runId) {
      findings.push(
        finding(
          "journal-run-id-drift",
          "error",
          "all events in one journal must use the same run_id",
          { line }
        )
      );
    } else if (!state.runId) {
      state.runId = runId;
    }
  }

  validateEventShape(event, eventType, attemptId, axis, line, findings);
  const key = recordAttemptIdentity(
    event,
    eventType,
    runId,
    cycleId,
    attemptId,
    axis,
    notePath,
    draftHash,
    state,
    line,
    findings
  );
  return { axis, eventType, key };
}

function requireCleanContract(
  event: Record<string, unknown>,
  axis: string,
  line: number,
  findings: Finding[]
): void {
  const labels =
    axis === "clarity" ? ["C1", "C2", "C3", "C4", "C5", "teach_back"] : ["A1"];
  for (const label of labels) {
    if (!present(event[label])) {
      findings.push(
        finding(
          "journal-clean-contract-missing",
          "error",
          `result=clean requires ${label}`,
          { line }
        )
      );
    }
  }
}

function validateCleanResult(
  event: Record<string, unknown>,
  axis: string,
  line: number,
  findings: Finding[]
): void {
  if (event.result !== "clean") {
    return;
  }
  const hasFindings = Array.isArray(event.findings)
    ? event.findings.length > 0
    : nonBlank(event.findings);
  const partial =
    event.source_coverage === "partial" ||
    (Array.isArray(event.unverified)
      ? event.unverified.length > 0
      : nonBlank(event.unverified));
  if (hasFindings || partial) {
    findings.push(
      finding(
        "journal-clean-contradiction",
        "error",
        "result=clean contradicts findings, partial coverage, or unverified claims",
        { line }
      )
    );
  }
  if (event.source_coverage !== "complete") {
    findings.push(
      finding(
        "journal-clean-coverage-missing",
        "error",
        "result=clean requires source_coverage=complete",
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
        "result=clean requires claims_checked",
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
        "result=clean requires reader after-state evidence",
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
        "result=clean requires reviewer identity evidence",
        { line }
      )
    );
  }
  if (axis === "clarity" || axis === "accuracy") {
    requireCleanContract(event, axis, line, findings);
  }
}

function validateAttemptTransition(
  eventType: string,
  attemptState: string,
  prior: string | undefined,
  line: number,
  findings: Finding[]
): void {
  if (prior && ["dispatch", "manual_fallback"].includes(eventType)) {
    findings.push(
      finding(
        "journal-attempt-restart-invalid",
        "error",
        "dispatch and manual_fallback may only start a new attempt_id",
        { line }
      )
    );
  }
  if (!prior && !["dispatch", "manual_fallback"].includes(eventType)) {
    findings.push(
      finding(
        "journal-attempt-start-invalid",
        "error",
        "an attempt must start with dispatch or manual_fallback",
        { line }
      )
    );
  }
  if (
    prior &&
    eventType !== "late_ignored" &&
    !TRANSITIONS[prior]?.has(attemptState)
  ) {
    findings.push(
      finding(
        "journal-transition-invalid",
        "error",
        `${prior} → ${attemptState} is not an allowed attempt transition`,
        { line }
      )
    );
  }
}

function validateDispatchState(
  eventType: string,
  attemptState: string,
  line: number,
  findings: Finding[]
): void {
  if (
    eventType === "dispatch" &&
    !["pending", "running"].includes(attemptState)
  ) {
    findings.push(
      finding(
        "journal-dispatch-state-invalid",
        "error",
        "dispatch must leave an attempt pending or running",
        { line }
      )
    );
  }
}

function validateObservationState(
  eventType: string,
  attemptState: string,
  line: number,
  findings: Finding[]
): void {
  if (
    ["progress", "poll"].includes(eventType) &&
    !["pending", "running"].includes(attemptState)
  ) {
    findings.push(
      finding(
        "journal-observation-state-invalid",
        "error",
        "progress and poll events require pending or running",
        { line }
      )
    );
  }
}

function validateResultState(
  event: Record<string, unknown>,
  eventType: string,
  attemptState: string,
  axis: string,
  line: number,
  findings: Finding[]
): void {
  if (eventType !== "result") {
    return;
  }
  if (attemptState !== "completed" || !RESULTS.has(String(event.result))) {
    findings.push(
      finding(
        "journal-result-state-invalid",
        "error",
        "result requires attempt_state=completed and result=clean/findings/unverified",
        { line }
      )
    );
  }
  validateCleanResult(event, axis, line, findings);
}

function validateFailureState(
  event: Record<string, unknown>,
  eventType: string,
  attemptState: string,
  line: number,
  findings: Finding[]
): void {
  if (eventType !== "failure") {
    return;
  }
  if (
    attemptState !== "failed" ||
    !nonBlank(event.failure_reason) ||
    present(event.result)
  ) {
    findings.push(
      finding(
        "journal-failure-state-invalid",
        "error",
        "failure requires attempt_state=failed and failure_reason, without result",
        { line }
      )
    );
  }
}

function validateStopState(
  eventType: string,
  attemptState: string,
  prior: string | undefined,
  line: number,
  findings: Finding[]
): void {
  if (
    eventType === "stop_requested" &&
    (!prior ||
      !["pending", "running"].includes(prior) ||
      attemptState !== prior)
  ) {
    findings.push(
      finding(
        "journal-stop-request-invalid",
        "error",
        "stop_requested must leave a pending or running attempt unchanged",
        { line }
      )
    );
  }
  if (
    eventType === "stop_confirmed" &&
    (attemptState !== "stopped" ||
      !prior ||
      !["pending", "running"].includes(prior))
  ) {
    findings.push(
      finding(
        "journal-stop-confirmation-invalid",
        "error",
        "stop_confirmed must transition pending/running to stopped",
        { line }
      )
    );
  }
}

function validateFallbackState(
  event: Record<string, unknown>,
  eventType: string,
  attemptState: string,
  line: number,
  findings: Finding[]
): void {
  if (
    eventType === "manual_fallback" &&
    (attemptState !== "completed" ||
      event.fallback !== "manual_checked" ||
      present(event.result))
  ) {
    findings.push(
      finding(
        "journal-fallback-state-invalid",
        "error",
        "manual_fallback requires completed, fallback=manual_checked, and no provider result",
        { line }
      )
    );
  }
}

function validateLateState(
  event: Record<string, unknown>,
  eventType: string,
  attemptState: string,
  prior: string | undefined,
  line: number,
  findings: Finding[]
): void {
  if (
    eventType === "late_ignored" &&
    (!prior || attemptState !== prior || present(event.result))
  ) {
    findings.push(
      finding(
        "journal-late-event-invalid",
        "error",
        "late_ignored must preserve the current attempt state and carry no result",
        { line }
      )
    );
  }
  if (
    prior &&
    ["completed", "failed", "stopped"].includes(prior) &&
    eventType !== "late_ignored"
  ) {
    findings.push(
      finding(
        "journal-terminal-reentry",
        "error",
        "a terminal attempt cannot receive another lifecycle event",
        { line }
      )
    );
  }
}

function validateAttemptEvent(
  event: Record<string, unknown>,
  key: string,
  eventType: string,
  axis: string,
  state: JournalState,
  line: number,
  findings: Finding[]
): void {
  const attemptState = String(event.attempt_state ?? "");
  if (!ATTEMPT_STATES.has(attemptState)) {
    findings.push(
      finding(
        "journal-attempt-state-invalid",
        "error",
        "attempt_state is not canonical",
        { line }
      )
    );
    return;
  }
  const prior = state.attemptStates.get(key);
  if (eventType === "dispatch" || eventType === "manual_fallback") {
    for (const [priorKey, identity] of state.identities.entries()) {
      if (
        priorKey !== key &&
        identity.axis === axis &&
        identity.note_revision === Number(event.note_revision) &&
        ["pending", "running"].includes(state.attemptStates.get(priorKey) ?? "")
      ) {
        findings.push(
          finding(
            "journal-concurrent-attempt",
            "error",
            "a new attempt cannot start while another attempt for the same axis and revision is pending or running",
            { line }
          )
        );
      }
    }
  }
  validateAttemptTransition(eventType, attemptState, prior, line, findings);
  validateDispatchState(eventType, attemptState, line, findings);
  validateObservationState(eventType, attemptState, line, findings);
  validateResultState(event, eventType, attemptState, axis, line, findings);
  validateFailureState(event, eventType, attemptState, line, findings);
  validateStopState(eventType, attemptState, prior, line, findings);
  validateFallbackState(event, eventType, attemptState, line, findings);
  validateLateState(event, eventType, attemptState, prior, line, findings);
  state.attemptStates.set(key, attemptState);
}

function validateClose(
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
        "review journal may have only one report_closed event",
        { line }
      )
    );
  }
  state.closeIndex = index;
  if (
    !Number.isInteger(event.close_order) ||
    Number(event.close_order) !== Number(event.order)
  ) {
    findings.push(
      finding(
        "journal-close-order-invalid",
        "error",
        "report_closed requires close_order equal to its event order",
        { line }
      )
    );
  } else {
    state.closeOrder = Number(event.close_order);
  }
  if (event.attempt_state !== undefined) {
    findings.push(
      finding(
        "journal-close-state-present",
        "error",
        "report_closed must not carry an attempt_state",
        { line }
      )
    );
  }
  if (
    [...state.attemptStates.values()].some((attemptState) =>
      ["pending", "running"].includes(attemptState)
    )
  ) {
    findings.push(
      finding(
        "journal-close-with-active-attempt",
        "error",
        "report_closed requires every attempt to be terminal; slow providers remain open until an explicit stop is confirmed",
        { line }
      )
    );
  }
}

function validateBudgetLimits(
  budget: Record<string, unknown>,
  findings: Finding[]
): boolean {
  const maxRevisionRounds = budget.max_revision_rounds;
  const revisionRounds = budget.revision_rounds;
  const maxAttempts = budget.max_attempts_per_axis_per_revision;
  const maxFallbacks = budget.max_fallback_passes_per_axis;
  const valid =
    Number.isInteger(maxRevisionRounds) &&
    Number(maxRevisionRounds) >= 0 &&
    Number(maxRevisionRounds) <= 2 &&
    Number.isInteger(revisionRounds) &&
    Number(revisionRounds) >= 0 &&
    Number(revisionRounds) <= Number(maxRevisionRounds) &&
    Number.isInteger(maxAttempts) &&
    Number(maxAttempts) >= 1 &&
    Number(maxAttempts) <= 2 &&
    Number.isInteger(maxFallbacks) &&
    Number(maxFallbacks) >= 0 &&
    Number(maxFallbacks) <= 1;
  if (!valid) {
    findings.push(
      finding(
        "journal-review-budget-invalid",
        "error",
        "review_budget must use max_revision_rounds<=2, max_attempts_per_axis_per_revision<=2, and max_fallback_passes_per_axis<=1"
      )
    );
  }
  return valid;
}

function validateBudgetRevision(
  budget: Record<string, unknown>,
  events: Record<string, unknown>[],
  findings: Finding[]
): void {
  const revisions: number[] = [];
  let previousRevision: number | undefined;
  for (const [index, event] of events.entries()) {
    if (
      event.event_type === "report_closed" ||
      event.event_type === "late_ignored"
    ) {
      continue;
    }
    const revision = Number(event.note_revision);
    if (!Number.isInteger(revision)) {
      continue;
    }
    if (previousRevision !== undefined && revision < previousRevision) {
      findings.push(
        finding(
          "journal-review-budget-revision-regressed",
          "error",
          "note_revision must be monotonic; a revision cannot move backward",
          { line: index + 1 }
        )
      );
    }
    if (previousRevision !== undefined && revision > previousRevision + 1) {
      findings.push(
        finding(
          "journal-review-budget-revision-jump",
          "error",
          "note_revision may advance by at most one per changed draft",
          { line: index + 1 }
        )
      );
    }
    previousRevision = revision;
    revisions.push(revision);
  }
  const actualRevisionRounds = revisions.length
    ? Math.max(...revisions) - Math.min(...revisions)
    : 0;
  if (actualRevisionRounds !== Number(budget.revision_rounds)) {
    findings.push(
      finding(
        "journal-review-budget-revision-mismatch",
        "error",
        "review_budget.revision_rounds must match the observed note_revision span"
      )
    );
  }
}

function observedRevisionRounds(events: Record<string, unknown>[]): number {
  const revisions = events
    .filter(
      (event) =>
        event.event_type !== "report_closed" &&
        event.event_type !== "late_ignored"
    )
    .map((event) => Number(event.note_revision))
    .filter((revision) => Number.isInteger(revision));
  return revisions.length ? Math.max(...revisions) - Math.min(...revisions) : 0;
}

function validateBudgetAttempts(
  budget: Record<string, unknown>,
  state: JournalState,
  findings: Finding[]
): void {
  const attemptsByRevisionAxis = new Map<string, number>();
  for (const identity of state.identities.values()) {
    if (identity.event_type === "manual_fallback") {
      continue;
    }
    const key = `${identity.note_revision}\u0000${identity.axis}`;
    attemptsByRevisionAxis.set(key, (attemptsByRevisionAxis.get(key) ?? 0) + 1);
  }
  if (
    [...attemptsByRevisionAxis.values()].some(
      (count) => count > Number(budget.max_attempts_per_axis_per_revision)
    )
  ) {
    findings.push(
      finding(
        "journal-review-budget-attempts-exceeded",
        "error",
        "review attempts exceeded max_attempts_per_axis_per_revision"
      )
    );
  }
}

function validateBudgetFallbacks(
  budget: Record<string, unknown>,
  events: Record<string, unknown>[],
  findings: Finding[]
): void {
  const fallbacksByAxis = new Map<string, number>();
  for (const event of events) {
    if (event.event_type !== "manual_fallback") {
      continue;
    }
    const axis = String(event.axis);
    fallbacksByAxis.set(axis, (fallbacksByAxis.get(axis) ?? 0) + 1);
  }
  if (
    [...fallbacksByAxis.values()].some(
      (count) => count > Number(budget.max_fallback_passes_per_axis)
    )
  ) {
    findings.push(
      finding(
        "journal-review-budget-fallbacks-exceeded",
        "error",
        "manual fallback exceeded max_fallback_passes_per_axis"
      )
    );
  }
}

function validateReviewBudget(
  closeEvent: Record<string, unknown>,
  events: Record<string, unknown>[],
  state: JournalState,
  findings: Finding[]
): Record<string, unknown> | undefined {
  const budget = isRecord(closeEvent.review_budget)
    ? closeEvent.review_budget
    : undefined;
  if (!budget) {
    findings.push(
      finding(
        "journal-review-budget-missing",
        "error",
        "report_closed requires review_budget evidence"
      )
    );
    return undefined;
  }
  if (!validateBudgetLimits(budget, findings)) {
    return budget;
  }
  validateBudgetRevision(budget, events, findings);
  validateBudgetAttempts(budget, state, findings);
  validateBudgetFallbacks(budget, events, findings);
  return budget;
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
    attemptStates: new Map<string, string>(),
    closeIndex: -1,
    closeOrder: Number.POSITIVE_INFINITY,
    eventIds: new Set<string>(),
    identities: new Map<string, Identity>(),
    previousOrder: 0,
    runId: undefined,
  };

  for (const [index, event] of events.entries()) {
    if (state.closeIndex >= 0 && event.event_type !== "late_ignored") {
      findings.push(
        finding(
          "journal-event-after-close",
          "error",
          "only late_ignored events may follow report_closed",
          { line: index + 1 }
        )
      );
    }
    const { key, eventType, axis } = validateIdentity(
      event,
      index,
      state,
      findings
    );
    if (eventType === "report_closed") {
      validateClose(event, index, state, findings);
    } else {
      validateAttemptEvent(
        event,
        key,
        eventType,
        axis,
        state,
        index + 1,
        findings
      );
    }
  }

  let reviewBudget: Record<string, unknown> | undefined;
  if (state.closeIndex >= 0) {
    const closeEvent = events[state.closeIndex];
    reviewBudget = closeEvent
      ? validateReviewBudget(closeEvent, events, state, findings)
      : undefined;
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
          "report_closed must follow at least one attempt event"
        )
      );
    }
  } else if (events.length > 0) {
    findings.push(
      finding(
        "journal-not-closed",
        allowOpen ? "warning" : "error",
        "journal has no report_closed event yet; use --allow-open only while the lifecycle is still running"
      )
    );
    if (allowOpen) {
      const openBudget = {
        max_attempts_per_axis_per_revision: 2,
        max_fallback_passes_per_axis: 1,
        max_revision_rounds: 2,
        revision_rounds: observedRevisionRounds(events),
      };
      validateBudgetLimits(openBudget, findings);
      validateBudgetRevision(openBudget, events, findings);
      validateBudgetAttempts(openBudget, state, findings);
      validateBudgetFallbacks(openBudget, events, findings);
    }
  }

  const errors = findings.filter((item) => item.severity === "error");
  return evidence(
    "check-review-journal",
    errors.length === 0 ? "passed" : "failed",
    { path: file },
    {
      attempts: state.identities.size,
      close_order: Number.isFinite(state.closeOrder)
        ? state.closeOrder
        : undefined,
      closed: state.closeIndex >= 0,
      events: events.length,
      review_budget: reviewBudget,
      run_id: state.runId,
    },
    findings
  );
}

function selfTest(): number {
  return withTempDir("knowledge-distiller-review-journal-", (root) => {
    const file = path.join(root, "journal.jsonl");
    const base = {
      attempt_id: "attempt-1",
      axis: "clarity",
      client_dispatch_id: "dispatch-1",
      cycle_id: "cycle-1",
      draft_hash: "a".repeat(64),
      evidence: { source: "self-test" },
      note_path: "/tmp/Note.md",
      note_revision: 1,
      observability: "observed",
      observed_at: "2026-08-10T00:00:00Z",
      provider_operation_id: "provider-1",
      run_id: "target-key/1",
    };
    const events = [
      {
        ...base,
        attempt_state: "pending",
        event_id: "e1",
        event_type: "dispatch",
        order: 1,
      },
      {
        ...base,
        attempt_state: "running",
        event_id: "e2",
        event_type: "progress",
        order: 2,
      },
      {
        ...base,
        C1: "—",
        C2: "—",
        C3: "—",
        C4: "—",
        C5: "—",
        after_state: "explain",
        attempt_state: "completed",
        claims_checked: 3,
        event_id: "e3",
        event_type: "result",
        findings: [],
        order: 3,
        result: "clean",
        source_coverage: "complete",
        teach_back: "reader can explain the model",
        unverified: "—",
      },
      {
        ...base,
        attempt_id: "run",
        attempt_state: undefined,
        axis: "system",
        close_order: 4,
        event_id: "e4",
        event_type: "report_closed",
        order: 4,
        review_budget: {
          max_attempts_per_axis_per_revision: 2,
          max_fallback_passes_per_axis: 1,
          max_revision_rounds: 2,
          revision_rounds: 0,
        },
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
      `${events.map((event, index) => JSON.stringify(index === 3 ? { ...event, review_budget: { ...events[3].review_budget, max_revision_rounds: 3 } } : event)).join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("review budget limits must fail closed");
    }

    fs.writeFileSync(
      file,
      `${events.map((event, index) => JSON.stringify(index === 1 ? { ...event, run_id: "target-key/2" } : event)).join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("cross-generation journal identity must fail");
    }

    fs.writeFileSync(
      file,
      `${events.map((event, index) => JSON.stringify(index === 2 ? { ...event, findings: ["contradiction"] } : event)).join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("contradictory clean result should fail");
    }

    fs.writeFileSync(
      file,
      `${events.map((event, index) => JSON.stringify(index === 0 ? { ...event, attempt_state: "completed", result: "clean" } : event)).join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("dispatch cannot masquerade as a completed result");
    }

    fs.writeFileSync(file, `${JSON.stringify(events[3])}\n`, "utf-8");
    if (check(file).gate !== "failed") {
      throw new Error("close-only journal should fail");
    }

    const stopped = [
      {
        ...base,
        attempt_state: "pending",
        event_id: "s1",
        event_type: "dispatch",
        order: 1,
      },
      {
        ...base,
        attempt_state: "running",
        event_id: "s2",
        event_type: "progress",
        order: 2,
      },
      {
        ...base,
        attempt_state: "running",
        event_id: "s3",
        event_type: "stop_requested",
        order: 3,
      },
      {
        ...base,
        attempt_state: "stopped",
        event_id: "s4",
        event_type: "stop_confirmed",
        order: 4,
      },
      {
        ...base,
        attempt_id: "run",
        axis: "system",
        close_order: 5,
        event_id: "s5",
        event_type: "report_closed",
        order: 5,
        review_budget: {
          max_attempts_per_axis_per_revision: 2,
          max_fallback_passes_per_axis: 1,
          max_revision_rounds: 2,
          revision_rounds: 0,
        },
      },
    ];
    fs.writeFileSync(
      file,
      `${stopped.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "passed") {
      throw new Error("explicit stop sequence should pass");
    }

    const retryThenFallback = [
      {
        ...base,
        attempt_id: "retry-1",
        attempt_state: "pending",
        event_id: "f1",
        event_type: "dispatch",
        order: 1,
      },
      {
        ...base,
        attempt_id: "retry-1",
        attempt_state: "failed",
        event_id: "f2",
        event_type: "failure",
        failure_reason: "provider_failed",
        order: 2,
      },
      {
        ...base,
        attempt_id: "retry-2",
        attempt_state: "pending",
        event_id: "f3",
        event_type: "dispatch",
        order: 3,
      },
      {
        ...base,
        attempt_id: "retry-2",
        attempt_state: "failed",
        event_id: "f4",
        event_type: "failure",
        failure_reason: "provider_failed_again",
        order: 4,
      },
      {
        ...base,
        attempt_id: "fallback-1",
        attempt_state: "completed",
        event_id: "f5",
        event_type: "manual_fallback",
        fallback: "manual_checked",
        fallback_id: "fallback-evidence-1",
        order: 5,
      },
      {
        ...base,
        attempt_id: "run",
        axis: "system",
        close_order: 6,
        event_id: "f6",
        event_type: "report_closed",
        order: 6,
        review_budget: {
          max_attempts_per_axis_per_revision: 2,
          max_fallback_passes_per_axis: 1,
          max_revision_rounds: 2,
          revision_rounds: 0,
        },
      },
    ];
    fs.writeFileSync(
      file,
      `${retryThenFallback.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "passed") {
      throw new Error("two provider attempts plus one fallback should pass");
    }

    fs.writeFileSync(
      file,
      `${retryThenFallback
        .map((event, index) =>
          JSON.stringify(index === 2 ? { ...event, note_revision: 0 } : event)
        )
        .join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("revision rollback must fail closed");
    }

    fs.writeFileSync(
      file,
      `${[retryThenFallback[0], retryThenFallback[5]]
        .map((event) =>
          JSON.stringify({
            ...event,
            close_order: event.event_id === "f6" ? 2 : undefined,
            order: event.event_id === "f6" ? 2 : 1,
          })
        )
        .join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("an active attempt cannot be closed");
    }

    fs.writeFileSync(
      file,
      `${[...stopped, { ...stopped[2], attempt_state: "completed", event_id: "s6", event_type: "result", order: 6, result: "clean" }].map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("non-late event after closure should fail");
    }

    console.log("review-journal checker self-test: PASS");
    return 0;
  });
}

function main(): number {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const allowOpen = args.includes("--allow-open");
  if (args.includes("--self-test")) {
    return selfTest();
  }
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
    console.log("OK: review journal is identity-safe and attempt-state-valid");
  } else {
    for (const item of result.findings.filter(
      (entry) => entry.severity === "error"
    )) {
      console.error(
        `ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`
      );
    }
  }
  return exitForGate(result.gate);
}

runMain(main);
