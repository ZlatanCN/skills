#!/usr/bin/env node
// Fail-closed validator for the machine-readable delivery decision.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import {
  evidence,
  exitForGate,
  fileHash,
  finding,
  isRecord,
  readJsonInput,
  nonEmptyString,
  runMain,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";

const WRITE_STATES = new Set([
  "written",
  "updated",
  "unchanged",
  "not_written",
  "possibly_partial",
]);
const GATES = new Set(["passed", "failed", "unavailable", "not_applicable"]);
const REVIEW_RESULTS = new Set([
  "clean",
  "findings",
  "unverified",
  "protocol_invalid",
  "unavailable",
]);
const REQUIRED_HARD_GATES = [
  "write_readback",
  "preservation",
  "heading",
  "teaching_model",
  "mechanical_link",
  "semantic_link",
  "evidence",
  "render",
];
const SUCCESS_LABELS = new Set([
  "双轴审查通过",
  "已交付；部分审查由人工复核",
  "已交付；存在未决项",
]);
const DELIVERY_LABELS = new Set([
  "双轴审查通过",
  "已交付；部分审查由人工复核",
  "已交付；存在未决项",
  "已写入；存在阻塞项，未完成",
  "文件已写入；自检未通过，未宣称交付",
  "更新未写入；原文件已保留",
  "内容已生成但未写入",
  "文件状态不确定，未宣称交付",
  "已写入；审查状态不确定，未完成",
  "未写入（审查不确定）",
  "未写入（仅草稿）",
  "未写入（阻塞）",
]);
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

type MutableDeliveryReport = {
  schema_version: string;
  label: string;
  write_status: string;
  note_path: string;
  hard_gates: Record<string, string>;
  review: {
    clarity: Record<string, unknown>;
    accuracy: Record<string, unknown>;
    journal: Record<string, unknown>;
    [key: string]: unknown;
  };
  open_blockers: unknown[];
  open_items: unknown[];
  artifact_kind: string;
  final_hash: string;
  [key: string]: unknown;
};

function readJournalEvents(file: string): Record<string, unknown>[] {
  return fs
    .readFileSync(file, "utf-8")
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function validateCreationProbeContent(
  probePath: string,
  report: Record<string, unknown>,
  findings: Finding[]
): void {
  try {
    const probeEvidence = JSON.parse(
      fs.readFileSync(probePath, "utf-8")
    ) as Record<string, unknown>;
    const notePath = path.resolve(String(report.note_path));
    const observedAt =
      typeof probeEvidence.checked_at === "string"
        ? Date.parse(probeEvidence.checked_at)
        : Number.NaN;
    if (
      probeEvidence.schema_version !==
        "knowledge-distiller.creation-probe.v1" ||
      probeEvidence.target_path !== notePath ||
      probeEvidence.target_existed !== false ||
      !Number.isFinite(observedAt)
    ) {
      findings.push(
        finding(
          "delivery-creation-probe-content-invalid",
          "error",
          "creation probe does not prove absence of this exact target with a valid observation time",
          { path: probePath }
        )
      );
    }
    if (fs.statSync(probePath).mtimeMs > fs.statSync(notePath).mtimeMs) {
      findings.push(
        finding(
          "delivery-creation-probe-order-invalid",
          "error",
          "creation probe evidence must have been materialized before the final note write",
          {
            evidence: {
              note_mtime: fs.statSync(notePath).mtimeMs,
              probe_mtime: fs.statSync(probePath).mtimeMs,
            },
            path: probePath,
          }
        )
      );
    }
  } catch (error) {
    findings.push(
      finding(
        "delivery-creation-probe-json-invalid",
        "error",
        `creation probe is not valid JSON: ${(error as Error).message}`,
        { path: probePath }
      )
    );
  }
}

function runJournalChecker(
  journalPath: string,
  findings: Finding[]
): Evidence | undefined {
  const child = spawnSync(
    process.execPath,
    [
      path.join(SCRIPT_DIR, "check-review-journal.ts"),
      "--journal",
      journalPath,
      "--json",
    ],
    { encoding: "utf-8" }
  );
  let checked: Evidence | undefined;
  try {
    checked = JSON.parse(child.stdout ?? "") as Evidence;
  } catch {
    findings.push(
      finding(
        "delivery-journal-check-invalid",
        "error",
        "the journal checker did not return a valid evidence envelope",
        {
          evidence: { stderr: child.stderr ?? "", stdout: child.stdout ?? "" },
          path: journalPath,
        }
      )
    );
  }
  if (!checked || checked.gate !== "passed" || child.status !== 0) {
    findings.push(
      finding(
        "delivery-journal-check-failed",
        "error",
        "the journal evidence does not pass its own closed-lifecycle checker",
        {
          evidence: { exit_code: child.status, gate: checked?.gate },
          path: journalPath,
        }
      )
    );
  }
  return checked;
}

function validateJournalSummary(
  journal: Record<string, unknown>,
  checked: Evidence | undefined,
  journalPath: string,
  findings: Finding[]
): void {
  if (
    checked?.metrics?.closed !== true ||
    checked.metrics.events !== journal.events ||
    checked.metrics.cutoff_order !== journal.cutoff_order
  ) {
    findings.push(
      finding(
        "delivery-journal-summary-mismatch",
        "error",
        "delivery journal summary does not match checker metrics",
        {
          evidence: {
            checked: checked?.metrics,
            declared: {
              closed: journal.closed,
              cutoff_order: journal.cutoff_order,
              events: journal.events,
            },
          },
          path: journalPath,
        }
      )
    );
  }
}

function validateCleanAxisBinding(
  axis: "clarity" | "accuracy",
  axisData: Record<string, unknown>,
  events: Record<string, unknown>[],
  notePath: string,
  journalPath: string,
  findings: Finding[]
): void {
  const matching = events.find(
    (event) =>
      event.axis === axis &&
      event.quality_result === "clean" &&
      event.cycle_id === axisData.cycle_id &&
      event.attempt_id === axisData.attempt_id &&
      event.note_revision === axisData.note_revision &&
      event.draft_hash === axisData.draft_hash &&
      event.note_path === notePath
  );
  if (!matching) {
    findings.push(
      finding(
        "delivery-clean-review-unbound",
        "error",
        `review.${axis} clean result is not bound to a matching clean event in the checked journal`,
        {
          evidence: {
            attempt_id: axisData.attempt_id,
            axis,
            draft_hash: axisData.draft_hash,
            note_path: notePath,
          },
          path: journalPath,
        }
      )
    );
    return;
  }
  const fields =
    axis === "clarity"
      ? [
          "source_coverage",
          "claims_checked",
          "after_state",
          "C1",
          "C2",
          "C3",
          "C4",
          "C5",
          "teach_back",
        ]
      : ["source_coverage", "claims_checked", "after_state", "A1"];
  for (const field of fields) {
    if (String(matching[field] ?? "") !== String(axisData[field] ?? "")) {
      findings.push(
        finding(
          "delivery-clean-review-summary-mismatch",
          "error",
          `review.${axis}.${field} does not match the bound journal event`,
          {
            evidence: {
              axis,
              field,
              journal: matching[field],
              report: axisData[field],
            },
            path: journalPath,
          }
        )
      );
    }
  }
}

function bindCleanReviews(
  report: Record<string, unknown>,
  journalPath: string,
  results: Record<string, string>,
  findings: Finding[]
): void {
  let events: Record<string, unknown>[] = [];
  try {
    events = readJournalEvents(journalPath);
  } catch (error) {
    findings.push(
      finding(
        "delivery-journal-events-invalid",
        "error",
        `could not read journal events: ${(error as Error).message}`,
        { path: journalPath }
      )
    );
  }
  const notePath = nonEmptyString(report.note_path)
    ? path.resolve(String(report.note_path))
    : "";
  for (const axis of ["clarity", "accuracy"] as const) {
    if (results[axis] !== "clean") {
      continue;
    }
    const review = report.review as Record<string, unknown>;
    const axisData = isRecord(review[axis])
      ? (review[axis] as Record<string, unknown>)
      : {};
    validateCleanAxisBinding(
      axis,
      axisData,
      events,
      notePath,
      journalPath,
      findings
    );
  }
}

function bindCreationProbe(
  report: Record<string, unknown>,
  findings: Finding[]
): void {
  if (report.write_status !== "written" && report.write_status !== "updated") {
    return;
  }
  if (report.artifact_kind !== "new_note") {
    return;
  }
  const probe = isRecord(report.creation_probe)
    ? report.creation_probe
    : undefined;
  if (
    !probe ||
    !nonEmptyString(probe.path) ||
    !nonEmptyString(probe.target_path) ||
    probe.target_existed !== false ||
    path.resolve(String(probe.target_path)) !==
      path.resolve(String(report.note_path))
  ) {
    findings.push(
      finding(
        "delivery-creation-probe-missing",
        "error",
        "a written new_note must carry a creation probe proving the target was absent before the write"
      )
    );
    return;
  }
  const probePath = path.resolve(String(probe.path));
  if (!fs.existsSync(probePath) || !fs.statSync(probePath).isFile()) {
    findings.push(
      finding(
        "delivery-creation-probe-file-missing",
        "error",
        "creation_probe.path does not exist",
        { path: probePath }
      )
    );
    return;
  }
  if (
    typeof probe.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(probe.sha256) ||
    fileHash(probePath) !== probe.sha256
  ) {
    findings.push(
      finding(
        "delivery-creation-probe-hash-invalid",
        "error",
        "creation_probe.sha256 does not match its evidence file",
        { path: probePath }
      )
    );
    return;
  }
  validateCreationProbeContent(probePath, report, findings);
}

function bindPassedJournal(
  journal: Record<string, unknown>,
  report: Record<string, unknown>,
  results: Record<string, string>,
  findings: Finding[]
): void {
  if (journal.gate !== "passed") {
    return;
  }
  if (!nonEmptyString(journal.path)) {
    findings.push(
      finding(
        "delivery-journal-path-missing",
        "error",
        "a passed review journal must identify its evidence file"
      )
    );
    return;
  }
  const journalPath = path.resolve(String(journal.path));
  if (!fs.existsSync(journalPath) || !fs.statSync(journalPath).isFile()) {
    findings.push(
      finding(
        "delivery-journal-file-missing",
        "error",
        "the passed review journal evidence file does not exist",
        { path: journalPath }
      )
    );
    return;
  }
  if (
    typeof journal.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(journal.sha256)
  ) {
    findings.push(
      finding(
        "delivery-journal-hash-missing",
        "error",
        "a passed review journal must include its SHA-256"
      )
    );
  } else {
    const actualHash = fileHash(journalPath);
    if (actualHash !== journal.sha256) {
      findings.push(
        finding(
          "delivery-journal-hash-mismatch",
          "error",
          "journal.sha256 does not match the evidence file",
          {
            evidence: { actual: actualHash, declared: journal.sha256 },
            path: journalPath,
          }
        )
      );
    }
  }
  const checked = runJournalChecker(journalPath, findings);
  validateJournalSummary(journal, checked, journalPath, findings);
  bindCleanReviews(report, journalPath, results, findings);
}

type GateContext = {
  gateObject: Record<string, unknown> | undefined;
  gateValues: string[];
};

type ReviewContext = {
  blockers: unknown[];
  journal: Record<string, unknown> | undefined;
  manualFallback: boolean;
  openItems: unknown[];
  results: Record<string, string>;
  review: Record<string, unknown> | undefined;
};

function validateWrittenArtifact(
  report: Record<string, unknown>,
  findings: Finding[]
): void {
  if (
    !nonEmptyString(report.note_path) ||
    !path.isAbsolute(String(report.note_path))
  ) {
    findings.push(
      finding(
        "delivery-note-path-ambiguous",
        "error",
        "a written artifact must use an absolute note_path"
      )
    );
    return;
  }
  const notePath = String(report.note_path);
  if (!fs.existsSync(notePath) || !fs.statSync(notePath).isFile()) {
    findings.push(
      finding(
        "delivery-note-missing",
        "error",
        "the written note_path does not exist",
        { path: notePath }
      )
    );
    return;
  }
  if (
    typeof report.final_hash !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(report.final_hash)
  ) {
    findings.push(
      finding(
        "delivery-final-hash-missing",
        "error",
        "a written artifact must include a SHA-256 final_hash"
      )
    );
    return;
  }
  const actualHash = fileHash(notePath);
  if (actualHash !== report.final_hash) {
    findings.push(
      finding(
        "delivery-final-hash-mismatch",
        "error",
        "final_hash does not match the written note bytes",
        {
          evidence: {
            actual: actualHash,
            declared: report.final_hash,
          },
          path: notePath,
        }
      )
    );
  }
}

function validateArtifact(
  report: Record<string, unknown>,
  findings: Finding[]
): boolean {
  if (report.schema_version !== "knowledge-distiller.delivery.v1") {
    findings.push(
      finding(
        "delivery-version-invalid",
        "error",
        "schema_version must be knowledge-distiller.delivery.v1"
      )
    );
  }
  if (!nonEmptyString(report.label)) {
    findings.push(
      finding("delivery-label-missing", "error", "label is required")
    );
  } else if (!DELIVERY_LABELS.has(String(report.label))) {
    findings.push(
      finding(
        "delivery-label-invalid",
        "error",
        "label is not in the canonical delivery matrix"
      )
    );
  }
  if (!WRITE_STATES.has(String(report.write_status))) {
    findings.push(
      finding(
        "delivery-write-state-invalid",
        "error",
        "write_status is not a canonical delivery state"
      )
    );
  }
  if (
    !nonEmptyString(report.note_path) &&
    report.write_status !== "not_written"
  ) {
    findings.push(
      finding(
        "delivery-note-path-missing",
        "error",
        "note_path is required for a written or uncertain artifact"
      )
    );
  }
  const written =
    report.write_status === "written" || report.write_status === "updated";
  if (written) {
    validateWrittenArtifact(report, findings);
  }
  if (
    !new Set(["new_note", "updated_note"]).has(String(report.artifact_kind))
  ) {
    findings.push(
      finding(
        "delivery-artifact-kind-invalid",
        "error",
        "artifact_kind must be new_note or updated_note"
      )
    );
  }
  return written;
}

function validateHardGates(
  report: Record<string, unknown>,
  findings: Finding[]
): GateContext {
  const gateObject = isRecord(report.hard_gates)
    ? report.hard_gates
    : undefined;
  if (!gateObject) {
    findings.push(
      finding("delivery-gates-missing", "error", "hard_gates must be an object")
    );
  }
  const gateValues: string[] = [];
  for (const [name, value] of Object.entries(gateObject ?? {})) {
    if (GATES.has(String(value))) {
      gateValues.push(String(value));
    } else {
      findings.push(
        finding(
          "delivery-gate-invalid",
          "error",
          `hard_gates.${name} has an unsupported status`
        )
      );
    }
    if (!REQUIRED_HARD_GATES.includes(name)) {
      findings.push(
        finding(
          "delivery-gate-unknown",
          "error",
          `hard_gates.${name} is not a canonical hard gate`
        )
      );
    }
  }
  if (gateObject && Object.keys(gateObject).length === 0) {
    findings.push(
      finding(
        "delivery-gates-empty",
        "error",
        "hard_gates must name every required hard gate"
      )
    );
  }
  for (const name of REQUIRED_HARD_GATES) {
    if (!gateObject || !(name in gateObject)) {
      findings.push(
        finding(
          "delivery-gate-missing",
          "error",
          `hard_gates.${name} is required`
        )
      );
    }
  }
  return { gateObject, gateValues };
}

function validateCleanReviewAxis(
  name: "clarity" | "accuracy",
  axis: Record<string, unknown>,
  written: boolean,
  finalHash: unknown,
  findings: Finding[]
): void {
  for (const field of [
    "cycle_id",
    "attempt_id",
    "observability",
    "source_coverage",
    "claims_checked",
    "after_state",
    "draft_hash",
  ]) {
    if (
      !nonEmptyString(axis[field]) &&
      !(typeof axis[field] === "number" && Number(axis[field]) > 0)
    ) {
      findings.push(
        finding(
          "delivery-clean-metadata-missing",
          "error",
          `review.${name}.${field} is required for quality_result=clean`
        )
      );
    }
  }
  if (!Number.isInteger(axis.note_revision) || Number(axis.note_revision) < 0) {
    findings.push(
      finding(
        "delivery-clean-revision-invalid",
        "error",
        `review.${name}.note_revision must be a non-negative integer for quality_result=clean`
      )
    );
  }
  if (written && axis.draft_hash !== finalHash) {
    findings.push(
      finding(
        "delivery-clean-hash-artifact-mismatch",
        "error",
        `review.${name}.draft_hash must equal final_hash for a written clean artifact`
      )
    );
  }
  if (axis.source_coverage !== "complete") {
    findings.push(
      finding(
        "delivery-clean-coverage-invalid",
        "error",
        `review.${name}.source_coverage must be complete for quality_result=clean`
      )
    );
  }
  if (
    typeof axis.draft_hash !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(axis.draft_hash)
  ) {
    findings.push(
      finding(
        "delivery-clean-hash-invalid",
        "error",
        `review.${name}.draft_hash must be SHA-256 for quality_result=clean`
      )
    );
  }
  const labels =
    name === "clarity" ? ["C1", "C2", "C3", "C4", "C5", "teach_back"] : ["A1"];
  for (const field of labels) {
    if (!nonEmptyString(axis[field])) {
      findings.push(
        finding(
          "delivery-clean-review-contract-missing",
          "error",
          `review.${name}.${field} is required for quality_result=clean`
        )
      );
    }
  }
}

function getReviewAxis(
  review: Record<string, unknown> | undefined,
  name: "clarity" | "accuracy"
): Record<string, unknown> {
  return isRecord(review?.[name])
    ? (review[name] as Record<string, unknown>)
    : {};
}

function validateReviewResults(
  review: Record<string, unknown> | undefined,
  report: Record<string, unknown>,
  written: boolean,
  findings: Finding[]
): Record<string, string> {
  const results: Record<string, string> = {};
  for (const name of ["clarity", "accuracy"] as const) {
    const axis = getReviewAxis(review, name);
    const result = String(axis.quality_result ?? "");
    if (REVIEW_RESULTS.has(result)) {
      results[name] = result;
    } else {
      findings.push(
        finding(
          "delivery-review-result-invalid",
          "error",
          `review.${name}.quality_result is missing or unsupported`
        )
      );
    }
    if (result === "clean") {
      validateCleanReviewAxis(name, axis, written, report.final_hash, findings);
    }
  }
  return results;
}

function validateReviewFallbacks(
  review: Record<string, unknown> | undefined,
  findings: Finding[]
): void {
  for (const name of ["clarity", "accuracy"] as const) {
    const { fallback } = getReviewAxis(review, name);
    if (fallback !== undefined && fallback !== "manual_checked") {
      findings.push(
        finding(
          "delivery-fallback-invalid",
          "error",
          `review.${name}.fallback must be manual_checked when present`
        )
      );
    }
  }
}

function validateReviewJournal(
  review: Record<string, unknown> | undefined,
  findings: Finding[]
): Record<string, unknown> | undefined {
  const journal = isRecord(review?.journal)
    ? (review.journal as Record<string, unknown>)
    : undefined;
  if (!journal) {
    findings.push(
      finding(
        "delivery-journal-missing",
        "error",
        "review.journal must be an object"
      )
    );
    return undefined;
  }
  if (!new Set(["passed", "failed", "unavailable"]).has(String(journal.gate))) {
    findings.push(
      finding(
        "delivery-journal-gate-invalid",
        "error",
        "review.journal.gate must be passed, failed, or unavailable"
      )
    );
  }
  if (journal.gate === "passed" && journal.closed !== true) {
    findings.push(
      finding(
        "delivery-journal-open",
        "error",
        "a passed review journal must be closed"
      )
    );
  }
  if (
    journal.gate === "passed" &&
    (!(typeof journal.events === "number" && journal.events > 0) ||
      !(typeof journal.cutoff_order === "number" && journal.cutoff_order > 0))
  ) {
    findings.push(
      finding(
        "delivery-journal-evidence-missing",
        "error",
        "a passed review journal must include positive events and cutoff_order"
      )
    );
  }
  return journal;
}

function validateReviewOpenItems(
  report: Record<string, unknown>,
  findings: Finding[]
): { blockers: unknown[]; openItems: unknown[] } {
  const blockers = Array.isArray(report.open_blockers)
    ? report.open_blockers
    : [];
  const openItems = Array.isArray(report.open_items) ? report.open_items : [];
  const classifications = new Set([
    "reader_blocker",
    "accuracy_blocker",
    "polish_item",
    "unverified",
  ]);
  for (const item of [...blockers, ...openItems]) {
    if (!isRecord(item) || !classifications.has(String(item.classification))) {
      findings.push(
        finding(
          "delivery-open-item-invalid",
          "error",
          "open items need a canonical classification"
        )
      );
    }
  }
  return { blockers, openItems };
}

function validateReview(
  report: Record<string, unknown>,
  written: boolean,
  findings: Finding[]
): ReviewContext {
  const review = isRecord(report.review) ? report.review : undefined;
  if (!review) {
    findings.push(
      finding("delivery-review-missing", "error", "review must be an object")
    );
  }
  const results = validateReviewResults(review, report, written, findings);
  validateReviewFallbacks(review, findings);
  const journal = validateReviewJournal(review, findings);
  const { blockers, openItems } = validateReviewOpenItems(report, findings);
  return {
    blockers,
    journal,
    manualFallback: review?.manual_fallback === true,
    openItems,
    results,
    review,
  };
}

function validateDeliveryRestrictions(
  report: Record<string, unknown>,
  written: boolean,
  gateObject: Record<string, unknown> | undefined,
  reviewContext: ReviewContext,
  findings: Finding[]
): void {
  if (reviewContext.journal) {
    bindPassedJournal(
      reviewContext.journal,
      report,
      reviewContext.results,
      findings
    );
  }
  bindCreationProbe(report, findings);
  if (
    gateObject?.preservation === "not_applicable" &&
    report.artifact_kind !== "new_note"
  ) {
    findings.push(
      finding(
        "delivery-preservation-not-applicable-invalid",
        "error",
        "preservation=not_applicable is valid only for a new_note artifact"
      )
    );
  }
  if (written && gateObject?.write_readback !== "passed") {
    findings.push(
      finding(
        "delivery-write-readback-required",
        "error",
        "a written or updated artifact must have write_readback=passed"
      )
    );
  }
  if (
    report.artifact_kind === "new_note" &&
    gateObject?.preservation === "passed"
  ) {
    findings.push(
      finding(
        "delivery-new-note-preservation-misclassified",
        "error",
        "a new_note should report preservation=not_applicable, not a fabricated update check"
      )
    );
  }
}

function hasDeliveryBlocker(
  blockers: unknown[],
  openItems: unknown[]
): boolean {
  return (
    blockers.length > 0 ||
    openItems.some(
      (item) =>
        isRecord(item) &&
        ["reader_blocker", "accuracy_blocker"].includes(
          String(item.classification)
        )
    )
  );
}

function validateSuccessLabelClaims(
  label: string,
  written: boolean,
  allHardPassed: boolean,
  bothClean: boolean,
  journalClosed: boolean,
  hasBlocker: boolean,
  reviewUncertain: boolean,
  findings: Finding[]
): void {
  if (
    label === "双轴审查通过" &&
    !(
      written &&
      allHardPassed &&
      bothClean &&
      journalClosed &&
      !hasBlocker &&
      !reviewUncertain
    )
  ) {
    findings.push(
      finding(
        "delivery-success-overclaim",
        "error",
        "双轴审查通过 requires confirmed write, all hard gates passed, both valid clean results, closed journal, and no blockers"
      )
    );
  }
  if (SUCCESS_LABELS.has(label) && !written) {
    findings.push(
      finding(
        "delivery-write-overclaim",
        "error",
        "a success delivery label requires write_status written or updated"
      )
    );
  }
  if (written && !allHardPassed && SUCCESS_LABELS.has(label)) {
    findings.push(
      finding(
        "delivery-gate-overclaim",
        "error",
        "a success delivery label cannot hide failed or unavailable hard gates"
      )
    );
  }
  if (reviewUncertain && SUCCESS_LABELS.has(label)) {
    findings.push(
      finding(
        "delivery-review-overclaim",
        "error",
        "an uncertain review state cannot use a success delivery label"
      )
    );
  }
  if (hasBlocker && SUCCESS_LABELS.has(label)) {
    findings.push(
      finding(
        "delivery-blocker-overclaim",
        "error",
        "reader/accuracy blockers cannot use a success delivery label"
      )
    );
  }
}

function validateManualFallbackClaim(
  label: string,
  reviewContext: ReviewContext,
  hasBlocker: boolean,
  findings: Finding[]
): void {
  const { journal, manualFallback, results, review } = reviewContext;
  const clarityManualFallback =
    isRecord(review?.clarity) && review.clarity.fallback === "manual_checked";
  const accuracyManualFallback =
    isRecord(review?.accuracy) && review.accuracy.fallback === "manual_checked";
  if (
    label === "已交付；部分审查由人工复核" &&
    !(
      manualFallback &&
      journal?.gate === "unavailable" &&
      results.clarity === "unavailable" &&
      results.accuracy === "unavailable" &&
      clarityManualFallback &&
      accuracyManualFallback &&
      !hasBlocker
    )
  ) {
    findings.push(
      finding(
        "delivery-manual-fallback-overclaim",
        "error",
        "partial manual-review delivery requires explicit manual_checked fallback for both unavailable axes"
      )
    );
  }
}

function validateOpenItemLabelClaim(
  label: string,
  openItems: unknown[],
  findings: Finding[]
): void {
  if (
    label === "已交付；存在未决项" &&
    openItems.some(
      (item) =>
        isRecord(item) &&
        ["reader_blocker", "accuracy_blocker"].includes(
          String(item.classification)
        )
    )
  ) {
    findings.push(
      finding(
        "delivery-open-blocker-overclaim",
        "error",
        "存在未决项 cannot contain reader or accuracy blockers"
      )
    );
  }
}

function validateWriteStateLabelClaims(
  report: Record<string, unknown>,
  label: string,
  findings: Finding[]
): void {
  if (report.write_status === "possibly_partial" && !label.includes("不确定")) {
    findings.push(
      finding(
        "delivery-partial-overclaim",
        "error",
        "possibly_partial writes must be reported as uncertain"
      )
    );
  }
  if (report.write_status === "not_written" && SUCCESS_LABELS.has(label)) {
    findings.push(
      finding(
        "delivery-not-written-overclaim",
        "error",
        "not_written cannot use a success delivery label"
      )
    );
  }
}

function validateDeliveryLabelClaims(
  report: Record<string, unknown>,
  written: boolean,
  gateValues: string[],
  reviewContext: ReviewContext,
  findings: Finding[]
): {
  allHardPassed: boolean;
  bothClean: boolean;
  journalClosed: boolean;
  label: string;
} {
  const { blockers, journal, manualFallback, openItems, results } =
    reviewContext;
  const label = String(report.label ?? "");
  const allHardPassed =
    gateValues.length > 0 &&
    gateValues.every(
      (value) => value === "passed" || value === "not_applicable"
    );
  const bothClean = results.clarity === "clean" && results.accuracy === "clean";
  const journalClosed = journal?.gate === "passed" && journal.closed === true;
  const hasBlocker = hasDeliveryBlocker(blockers, openItems);
  const reviewUncertain =
    report.review_uncertain === true ||
    journal?.gate === "failed" ||
    (journal?.gate === "unavailable" && !manualFallback);
  validateSuccessLabelClaims(
    label,
    written,
    allHardPassed,
    bothClean,
    journalClosed,
    hasBlocker,
    reviewUncertain,
    findings
  );
  validateManualFallbackClaim(label, reviewContext, hasBlocker, findings);
  validateOpenItemLabelClaim(label, openItems, findings);
  validateWriteStateLabelClaims(report, label, findings);
  return { allHardPassed, bothClean, journalClosed, label };
}

function check(input: string): Evidence {
  const findings: Finding[] = [];
  let report: unknown;
  try {
    report = readJsonInput(input);
  } catch (error) {
    findings.push(
      finding(
        "delivery-json-invalid",
        "error",
        `delivery report is not valid JSON: ${(error as Error).message}`
      )
    );
    return evidence(
      "check-delivery-report",
      "failed",
      { report: input },
      {},
      findings
    );
  }
  if (!isRecord(report)) {
    findings.push(
      finding(
        "delivery-root-type",
        "error",
        "delivery report root must be an object"
      )
    );
    return evidence(
      "check-delivery-report",
      "failed",
      { report: input },
      {},
      findings
    );
  }
  const written = validateArtifact(report, findings);
  const { gateObject, gateValues } = validateHardGates(report, findings);

  const reviewContext = validateReview(report, written, findings);

  validateDeliveryRestrictions(
    report,
    written,
    gateObject,
    reviewContext,
    findings
  );
  const deliveryState = validateDeliveryLabelClaims(
    report,
    written,
    gateValues,
    reviewContext,
    findings
  );

  const errors = findings.filter((item) => item.severity === "error");
  return evidence(
    "check-delivery-report",
    errors.length === 0 ? "passed" : "failed",
    { report: input },
    {
      all_hard_gates_passed: deliveryState.allHardPassed,
      blocker_count: reviewContext.blockers.length,
      both_clean: deliveryState.bothClean,
      journal_closed: deliveryState.journalClosed,
      label: deliveryState.label,
      open_item_count: reviewContext.openItems.length,
      write_status: report.write_status,
    },
    findings
  );
}

function selfTest(): number {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-distiller-delivery-")
  );
  try {
    const file = path.join(root, "report.json");
    const report: MutableDeliveryReport = {
      artifact_kind: "updated_note",
      final_hash: "b".repeat(64),
      hard_gates: {
        evidence: "passed",
        heading: "passed",
        mechanical_link: "passed",
        preservation: "passed",
        render: "passed",
        semantic_link: "passed",
        teaching_model: "passed",
        write_readback: "passed",
      },
      label: "双轴审查通过",
      note_path: "/tmp/Note.md",
      open_blockers: [],
      open_items: [],
      review: {
        accuracy: {
          A1: "—",
          after_state: "explain",
          attempt_id: "accuracy-1",
          claims_checked: 3,
          cycle_id: "cycle-1",
          draft_hash: "a".repeat(64),
          note_revision: 1,
          observability: "provider",
          quality_result: "clean",
          source_coverage: "complete",
        },
        clarity: {
          C1: "—",
          C2: "—",
          C3: "—",
          C4: "—",
          C5: "—",
          after_state: "explain",
          attempt_id: "clarity-1",
          claims_checked: 3,
          cycle_id: "cycle-1",
          draft_hash: "a".repeat(64),
          note_revision: 1,
          observability: "provider",
          quality_result: "clean",
          source_coverage: "complete",
          teach_back: "reader can explain",
        },
        journal: { closed: true, cutoff_order: 2, events: 3, gate: "passed" },
      },
      schema_version: "knowledge-distiller.delivery.v1",
      write_status: "updated",
    };
    const note = path.join(root, "Note.md");
    fs.writeFileSync(note, "# Note\n", "utf-8");
    report.note_path = note;
    report.final_hash = fileHash(note);
    report.review.clarity.draft_hash = report.final_hash;
    report.review.accuracy.draft_hash = report.final_hash;
    fs.writeFileSync(file, JSON.stringify(report), "utf-8");
    if (check(file).gate !== "failed") {
      throw new Error("unbound journal must fail closed");
    }
    const journalPath = path.join(root, "journal.jsonl");
    const journalBase = {
      cancel_state: "not_requested",
      client_dispatch_id: "dispatch",
      cycle_id: "cycle-1",
      draft_hash: report.final_hash,
      evidence: { source: "self-test" },
      note_path: note,
      note_revision: 1,
      observability: "self-test",
      observed_at: "2026-08-10T00:00:00Z",
      parent_wait_state: "waiting",
      provider_execution_state: "pending",
      provider_liveness: "unobserved",
      provider_operation_id: "provider",
    };
    const journalEvents = [
      {
        ...journalBase,
        attempt_id: "clarity-1",
        axis: "clarity",
        event_id: "j1",
        event_type: "dispatch",
        order: 1,
        quality_result: "unavailable",
        state_after: "active",
        state_before: "pending",
      },
      {
        ...journalBase,
        C1: "—",
        C2: "—",
        C3: "—",
        C4: "—",
        C5: "—",
        after_state: "explain",
        attempt_id: "clarity-1",
        axis: "clarity",
        claims_checked: 3,
        event_id: "j2",
        event_type: "result",
        findings: [],
        order: 2,
        provider_execution_state: "completed",
        provider_liveness: "terminal",
        quality_result: "clean",
        source_coverage: "complete",
        state_after: "completed",
        state_before: "active",
        teach_back: "reader can explain",
        unverified: "—",
      },
      {
        ...journalBase,
        attempt_id: "accuracy-1",
        axis: "accuracy",
        event_id: "j3",
        event_type: "dispatch",
        order: 3,
        quality_result: "unavailable",
        state_after: "active",
        state_before: "pending",
      },
      {
        ...journalBase,
        A1: "—",
        after_state: "explain",
        attempt_id: "accuracy-1",
        axis: "accuracy",
        claims_checked: 3,
        event_id: "j4",
        event_type: "result",
        findings: [],
        order: 4,
        provider_execution_state: "completed",
        provider_liveness: "terminal",
        quality_result: "clean",
        source_coverage: "complete",
        state_after: "completed",
        state_before: "active",
        unverified: "—",
      },
      {
        ...journalBase,
        attempt_id: "close-1",
        axis: "system",
        cutoff_order: 4,
        event_id: "j5",
        event_type: "report_closed",
        order: 5,
        parent_wait_state: "closed",
        quality_result: "unavailable",
        state_after: "closed",
        state_before: "completed",
      },
    ];
    fs.writeFileSync(
      journalPath,
      `${journalEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf-8"
    );
    report.review.journal = {
      closed: true,
      cutoff_order: 4,
      events: 5,
      gate: "passed",
      path: journalPath,
      sha256: fileHash(journalPath),
    };
    fs.writeFileSync(file, JSON.stringify(report), "utf-8");
    if (check(file).gate !== "passed") {
      throw new Error("hash-bound journal and final artifact should pass");
    }
    const probePath = path.join(root, "creation-probe.json");
    fs.writeFileSync(
      probePath,
      JSON.stringify({
        checked_at: "2026-08-10T00:00:00Z",
        schema_version: "knowledge-distiller.creation-probe.v1",
        target_existed: false,
        target_path: note,
      }),
      "utf-8"
    );
    const noteAfterProbe = new Date(Date.now() + 1000);
    fs.utimesSync(note, noteAfterProbe, noteAfterProbe);
    const newReport = {
      ...report,
      artifact_kind: "new_note",
      creation_probe: {
        path: probePath,
        sha256: fileHash(probePath),
        target_existed: false,
        target_path: note,
      },
      hard_gates: { ...report.hard_gates, preservation: "not_applicable" },
    };
    fs.writeFileSync(file, JSON.stringify(newReport), "utf-8");
    if (check(file).gate !== "passed") {
      throw new Error("a new note with a bound creation probe should pass");
    }
    fs.writeFileSync(
      file,
      JSON.stringify({ ...newReport, creation_probe: undefined }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("a new note without a creation probe must fail");
    }
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...report,
        review: {
          ...report.review,
          clarity: { ...report.review.clarity, C1: "fabricated summary" },
        },
      }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error(
        "clean summary fields must match the bound journal event"
      );
    }
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...report,
        review: {
          accuracy: { quality_result: "clean" },
          clarity: { quality_result: "clean" },
          journal: { closed: true, cutoff_order: 2, events: 3, gate: "passed" },
        },
      }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("clean axes without reviewer metadata should fail");
    }
    fs.writeFileSync(
      file,
      JSON.stringify({ ...report, hard_gates: { bogus: "passed" } }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("incomplete hard-gate set should fail");
    }
    fs.writeFileSync(
      file,
      JSON.stringify({ ...report, label: "假的通过标签" }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("unknown delivery label should fail");
    }
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...report,
        label: "已交付；部分审查由人工复核",
        review: {
          accuracy: {
            fallback: "manual_checked",
            quality_result: "unavailable",
          },
          clarity: {
            fallback: "manual_checked",
            quality_result: "unavailable",
          },
          journal: { closed: false, gate: "unavailable" },
          manual_fallback: true,
        },
      }),
      "utf-8"
    );
    if (check(file).gate !== "passed") {
      throw new Error("explicit two-axis manual fallback should pass");
    }
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...report,
        artifact_kind: "updated_note",
        hard_gates: { ...report.hard_gates, preservation: "not_applicable" },
      }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error(
        "not_applicable preservation must be restricted to new notes"
      );
    }
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...report,
        hard_gates: { ...report.hard_gates, write_readback: "failed" },
      }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("failed hard gate must reject clean delivery");
    }
    console.log("delivery-report checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    return selfTest();
  }
  const json = args.includes("--json");
  let report = "";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--report") {
      i += 1;
      report = args[i] ?? "";
    } else if (!["--json", "--help", "-h"].includes(args[i])) {
      throw new Error(`unknown argument: ${args[i]}`);
    }
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: node scripts/check-delivery-report.ts --report REPORT.json [--json]"
    );
    console.log("       node scripts/check-delivery-report.ts --self-test");
    return 0;
  }
  if (!report) {
    throw new Error(
      "usage: node scripts/check-delivery-report.ts --report REPORT.json"
    );
  }
  const result = check(report);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.gate === "passed") {
    console.log(
      "OK: delivery label is consistent with write, gate, and review evidence"
    );
  } else {
    for (const item of result.findings) {
      if (item.severity === "error") {
        console.error(
          `ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`
        );
      }
    }
  }
  return exitForGate(result.gate);
}

runMain(main);
