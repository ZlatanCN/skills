#!/usr/bin/env node
// Fail-closed validator for the machine-readable delivery decision.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
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
  sha256,
  withTempDir,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";

const WRITE_STATES = new Set([
  "not_applicable",
  "idle",
  "staging",
  "committed",
  "uncertain",
]);
const WRITE_OUTCOMES = new Set(["created", "updated", "unchanged"]);
const GATES = new Set(["passed", "failed", "unavailable", "not_applicable"]);
const REVIEW_OUTCOMES = new Set([
  "provider_clean",
  "provider_findings",
  "provider_unverified",
  "manual_checked",
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
const DELIVERY_SCHEMA_VERSION = "knowledge-distiller.delivery.v3";
const LEGACY_DELIVERY_SCHEMA_VERSION = "knowledge-distiller.delivery.v2";
const SHA256_RE = /^[a-f0-9]{64}$/iu;
const MANIFEST_BASENAMES = {
  draft: "draft.md",
  format_plan: "format-plan.json",
  manifest: "manifest.json",
  review: "review.jsonl",
  teaching_model: "teaching-model.json",
} as const;

type MutableDeliveryReport = {
  schema_version: string;
  run_id: string;
  label: string;
  write_state: string;
  write_outcome?: string;
  manifest?: { path: string; sha256: string };
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

type ReadManifest = {
  path: string;
  value: Record<string, unknown>;
};

function readManifest(
  report: Record<string, unknown>,
  findings: Finding[]
): ReadManifest | undefined {
  const reference = isRecord(report.manifest) ? report.manifest : undefined;
  const manifestPath = String(reference?.path ?? "");
  const declaredHash = String(reference?.sha256 ?? "");
  if (!path.isAbsolute(manifestPath) || !SHA256_RE.test(declaredHash)) {
    findings.push(
      finding(
        "delivery-manifest-reference-invalid",
        "error",
        "persisted artifacts need an absolute manifest path and SHA-256"
      )
    );
    return undefined;
  }
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    findings.push(
      finding(
        "delivery-manifest-missing",
        "error",
        "manifest.path does not identify an existing file",
        { path: manifestPath }
      )
    );
    return undefined;
  }
  if (fileHash(manifestPath) !== declaredHash) {
    findings.push(
      finding(
        "delivery-manifest-hash-mismatch",
        "error",
        "manifest.sha256 does not match the manifest bytes",
        { path: manifestPath }
      )
    );
  }
  try {
    const value: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (!isRecord(value)) {
      throw new Error("manifest root must be an object");
    }
    return { path: manifestPath, value };
  } catch (error) {
    findings.push(
      finding(
        "delivery-manifest-json-invalid",
        "error",
        `manifest is not valid JSON: ${(error as Error).message}`,
        { path: manifestPath }
      )
    );
    return undefined;
  }
}

function validateManifestIdentity(
  report: Record<string, unknown>,
  manifest: ReadManifest,
  findings: Finding[]
): { draftHashValid: boolean; generation: number; targetKey: string } {
  const targetPath = path.resolve(String(report.note_path ?? ""));
  const targetKey = sha256(targetPath).slice(0, 16);
  const generation = Number(manifest.value.generation);
  const identityValid =
    manifest.value.schema_version === "knowledge-distiller.manifest.v1" &&
    manifest.value.run_id === report.run_id &&
    manifest.value.target_path === targetPath &&
    manifest.value.target_key === targetKey &&
    manifest.value.artifact_kind === report.artifact_kind &&
    Number.isInteger(manifest.value.generation) &&
    generation > 0 &&
    manifest.value.run_id === `${targetKey}/${String(generation)}`;
  if (!identityValid) {
    findings.push(
      finding(
        "delivery-manifest-identity-invalid",
        "error",
        "manifest identity does not match the delivery target, run_id, or generation",
        { path: manifest.path }
      )
    );
  }
  const originalValid =
    manifest.value.artifact_kind === "new_note"
      ? manifest.value.original_hash === null
      : typeof manifest.value.original_hash === "string" &&
        SHA256_RE.test(manifest.value.original_hash);
  if (!originalValid) {
    findings.push(
      finding(
        "delivery-manifest-original-hash-invalid",
        "error",
        "manifest original_hash must be null for new_note or SHA-256 for updated_note",
        { path: manifest.path }
      )
    );
  }
  const draftHashValid =
    typeof manifest.value.draft_hash === "string" &&
    SHA256_RE.test(manifest.value.draft_hash);
  if (!draftHashValid) {
    findings.push(
      finding(
        "delivery-manifest-draft-hash-invalid",
        "error",
        "manifest.draft_hash must be a SHA-256 digest",
        { path: manifest.path }
      )
    );
  } else if (
    report.write_state === "committed" &&
    manifest.value.draft_hash !== report.final_hash
  ) {
    findings.push(
      finding(
        "delivery-manifest-final-hash-mismatch",
        "error",
        "committed final_hash must equal manifest.draft_hash",
        { path: manifest.path }
      )
    );
  }
  return { draftHashValid, generation, targetKey };
}

function validateManifestFiles(
  manifest: ReadManifest,
  reportPath: string,
  identity: { draftHashValid: boolean; generation: number; targetKey: string },
  findings: Finding[]
): void {
  const directory = path.dirname(manifest.path);
  const expected = {
    ...Object.fromEntries(
      Object.entries(MANIFEST_BASENAMES).map(([name, basename]) => [
        name,
        path.join(directory, basename),
      ])
    ),
    delivery: path.resolve(reportPath),
  } as Record<string, string>;
  const artifacts = isRecord(manifest.value.artifacts)
    ? manifest.value.artifacts
    : undefined;
  if (!artifacts) {
    findings.push(
      finding(
        "delivery-manifest-artifacts-missing",
        "error",
        "manifest.artifacts must list the fixed run files",
        { path: manifest.path }
      )
    );
    return;
  }
  for (const [name, expectedPath] of Object.entries(expected)) {
    const declaredPath = artifacts[name];
    if (
      typeof declaredPath !== "string" ||
      path.resolve(declaredPath) !== expectedPath ||
      !fs.existsSync(expectedPath) ||
      !fs.statSync(expectedPath).isFile()
    ) {
      findings.push(
        finding(
          "delivery-manifest-artifact-invalid",
          "error",
          `manifest artifact ${name} must be the existing fixed run file`,
          { path: expectedPath }
        )
      );
    }
  }
  if (
    path.basename(directory) !== String(identity.generation) ||
    path.basename(path.dirname(directory)) !== identity.targetKey
  ) {
    findings.push(
      finding(
        "delivery-manifest-directory-invalid",
        "error",
        "manifest must live under <target-key>/<generation>",
        { path: manifest.path }
      )
    );
  }
  const draftPath = expected.draft;
  if (
    identity.draftHashValid &&
    fs.existsSync(draftPath) &&
    fileHash(draftPath) !== manifest.value.draft_hash
  ) {
    findings.push(
      finding(
        "delivery-manifest-draft-bytes-mismatch",
        "error",
        "manifest.draft_hash does not match draft.md bytes",
        { path: draftPath }
      )
    );
  }
}

function validateRunManifest(
  report: Record<string, unknown>,
  reportPath: string,
  findings: Finding[]
): void {
  if (
    !new Set(["staging", "committed", "uncertain"]).has(
      String(report.write_state)
    )
  ) {
    return;
  }
  const manifest = readManifest(report, findings);
  if (!manifest) {
    return;
  }
  const identity = validateManifestIdentity(report, manifest, findings);
  validateManifestFiles(manifest, reportPath, identity, findings);
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
  runId: string,
  findings: Finding[]
): void {
  if (journal.run_id !== runId || checked?.metrics?.run_id !== runId) {
    findings.push(
      finding(
        "delivery-journal-run-id-mismatch",
        "error",
        "delivery and journal evidence must use the same run_id",
        {
          evidence: {
            checked: checked?.metrics?.run_id,
            delivery: runId,
            journal: journal.run_id,
          },
          path: journalPath,
        }
      )
    );
  }
  if (
    checked?.metrics?.closed !== true ||
    checked.metrics.events !== journal.events ||
    checked.metrics.close_order !== journal.close_order ||
    JSON.stringify(checked?.metrics?.review_budget) !==
      JSON.stringify(journal.review_budget)
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
              close_order: journal.close_order,
              closed: journal.closed,
              events: journal.events,
              review_budget: journal.review_budget,
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
  runId: string,
  findings: Finding[]
): void {
  const matching = events.find(
    (event) =>
      event.axis === axis &&
      event.result === "clean" &&
      event.cycle_id === axisData.cycle_id &&
      event.attempt_id === axisData.attempt_id &&
      event.run_id === runId &&
      event.note_revision === axisData.note_revision &&
      event.draft_hash === axisData.draft_hash &&
      event.note_path === notePath
  );
  if (!matching) {
    findings.push(
      finding(
        "delivery-clean-review-unbound",
        "error",
        `review.${axis} provider_clean outcome is not bound to a matching clean event in the checked journal`,
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
    if (results[axis] !== "provider_clean") {
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
      String(report.run_id ?? ""),
      findings
    );
  }
}

function bindCreationProbe(
  report: Record<string, unknown>,
  findings: Finding[]
): void {
  if (report.write_state !== "committed") {
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
  validateJournalSummary(
    journal,
    checked,
    journalPath,
    String(report.run_id ?? ""),
    findings
  );
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
  reportPath: string,
  findings: Finding[]
): boolean {
  if (report.schema_version !== DELIVERY_SCHEMA_VERSION) {
    findings.push(
      finding(
        report.schema_version === LEGACY_DELIVERY_SCHEMA_VERSION
          ? "delivery-schema-legacy"
          : "delivery-version-invalid",
        "error",
        report.schema_version === LEGACY_DELIVERY_SCHEMA_VERSION
          ? "knowledge-distiller.delivery.v2 is a legacy pre-manifest contract; regenerate the report as delivery.v3"
          : `schema_version must be ${DELIVERY_SCHEMA_VERSION}`
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
  if (!WRITE_STATES.has(String(report.write_state))) {
    findings.push(
      finding(
        "delivery-write-state-invalid",
        "error",
        "write_state is not a canonical delivery state"
      )
    );
  }
  if (
    !nonEmptyString(report.note_path) &&
    !["not_applicable", "idle"].includes(String(report.write_state))
  ) {
    findings.push(
      finding(
        "delivery-note-path-missing",
        "error",
        "note_path is required for a written or uncertain artifact"
      )
    );
  }
  const committed = report.write_state === "committed";
  if (
    ["committed", "staging", "uncertain"].includes(
      String(report.write_state)
    ) &&
    !nonEmptyString(report.run_id)
  ) {
    findings.push(
      finding(
        "delivery-run-id-missing",
        "error",
        "a persisted or uncertain artifact must include run_id"
      )
    );
  }
  const written =
    committed && ["created", "updated"].includes(String(report.write_outcome));
  if (committed && !WRITE_OUTCOMES.has(String(report.write_outcome))) {
    findings.push(
      finding(
        "delivery-write-outcome-invalid",
        "error",
        "committed write_state requires write_outcome created, updated, or unchanged"
      )
    );
  } else if (!committed && report.write_outcome !== undefined) {
    findings.push(
      finding(
        "delivery-write-outcome-illegal",
        "error",
        "write_outcome is only valid when write_state=committed"
      )
    );
  }
  if (committed) {
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
  validateRunManifest(report, reportPath, findings);
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
          `review.${name}.${field} is required for outcome=provider_clean`
        )
      );
    }
  }
  if (!Number.isInteger(axis.note_revision) || Number(axis.note_revision) < 0) {
    findings.push(
      finding(
        "delivery-clean-revision-invalid",
        "error",
        `review.${name}.note_revision must be a non-negative integer for outcome=provider_clean`
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
        `review.${name}.source_coverage must be complete for outcome=provider_clean`
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
        `review.${name}.draft_hash must be SHA-256 for outcome=provider_clean`
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
          `review.${name}.${field} is required for outcome=provider_clean`
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
    const outcome = String(axis.outcome ?? "");
    if (REVIEW_OUTCOMES.has(outcome)) {
      results[name] = outcome;
    } else {
      findings.push(
        finding(
          "delivery-review-result-invalid",
          "error",
          `review.${name}.outcome is missing or unsupported`
        )
      );
    }
    if (outcome === "provider_clean") {
      validateCleanReviewAxis(name, axis, written, report.final_hash, findings);
    }
  }
  return results;
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
      !(typeof journal.close_order === "number" && journal.close_order > 0))
  ) {
    findings.push(
      finding(
        "delivery-journal-evidence-missing",
        "error",
        "a passed review journal must include positive events and close_order"
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
  const journal = validateReviewJournal(review, findings);
  const { blockers, openItems } = validateReviewOpenItems(report, findings);
  return {
    blockers,
    journal,
    manualFallback:
      results.clarity === "manual_checked" &&
      results.accuracy === "manual_checked",
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
  if (
    report.write_state === "committed" &&
    gateObject?.write_readback !== "passed"
  ) {
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
        "a success delivery label requires write_state=committed with write_outcome=created or updated"
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
  const { journal, manualFallback, results } = reviewContext;
  if (
    label === "已交付；部分审查由人工复核" &&
    !(
      manualFallback &&
      journal?.gate === "unavailable" &&
      results.clarity === "manual_checked" &&
      results.accuracy === "manual_checked" &&
      !hasBlocker
    )
  ) {
    findings.push(
      finding(
        "delivery-manual-fallback-overclaim",
        "error",
        "partial manual-review delivery requires manual_checked outcome for both axes and an unavailable journal"
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
  if (report.write_state === "uncertain" && !label.includes("不确定")) {
    findings.push(
      finding(
        "delivery-partial-overclaim",
        "error",
        "uncertain writes must be reported as uncertain"
      )
    );
  }
  if (
    !["committed"].includes(String(report.write_state)) &&
    SUCCESS_LABELS.has(label)
  ) {
    findings.push(
      finding(
        "delivery-not-written-overclaim",
        "error",
        "a non-committed write cannot use a success delivery label"
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
  const bothClean =
    results.clarity === "provider_clean" &&
    results.accuracy === "provider_clean";
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
  const written = validateArtifact(report, input, findings);
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
      write_outcome: report.write_outcome,
      write_state: report.write_state,
    },
    findings
  );
}

function selfTest(): number {
  return withTempDir("knowledge-distiller-delivery-", (root) => {
    const note = path.join(root, "Note.md");
    const targetKey = sha256(path.resolve(note)).slice(0, 16);
    const bundle = path.join(root, targetKey, "1");
    fs.mkdirSync(bundle, { recursive: true });
    const file = path.join(bundle, "delivery.json");
    const manifestPath = path.join(bundle, "manifest.json");
    const draftPath = path.join(bundle, "draft.md");
    const teachingModelPath = path.join(bundle, "teaching-model.json");
    const formatPlanPath = path.join(bundle, "format-plan.json");
    const journalPath = path.join(bundle, "review.jsonl");
    fs.writeFileSync(note, "# Note\n", "utf-8");
    fs.writeFileSync(draftPath, "# Note\n", "utf-8");
    fs.writeFileSync(teachingModelPath, "{}\n", "utf-8");
    fs.writeFileSync(formatPlanPath, "{}\n", "utf-8");
    const noteHash = fileHash(note);
    const report: MutableDeliveryReport = {
      artifact_kind: "updated_note",
      final_hash: noteHash,
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
      manifest: { path: manifestPath, sha256: "0".repeat(64) },
      note_path: note,
      open_blockers: [],
      open_items: [],
      review: {
        accuracy: {
          A1: "—",
          after_state: "explain",
          attempt_id: "accuracy-1",
          claims_checked: 3,
          cycle_id: "cycle-1",
          draft_hash: noteHash,
          note_revision: 1,
          observability: "observed",
          outcome: "provider_clean",
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
          draft_hash: noteHash,
          note_revision: 1,
          observability: "observed",
          outcome: "provider_clean",
          source_coverage: "complete",
          teach_back: "reader can explain",
        },
        journal: {
          close_order: 7,
          closed: true,
          events: 7,
          gate: "passed",
          run_id: `${targetKey}/1`,
        },
      },
      run_id: `${targetKey}/1`,
      schema_version: DELIVERY_SCHEMA_VERSION,
      write_outcome: "updated",
      write_state: "committed",
    };
    function writeManifest(
      artifactKind: string,
      originalHash: string | null
    ): void {
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          artifact_kind: artifactKind,
          artifacts: {
            delivery: file,
            draft: draftPath,
            format_plan: formatPlanPath,
            manifest: manifestPath,
            review: journalPath,
            teaching_model: teachingModelPath,
          },
          draft_hash: report.final_hash,
          generation: 1,
          original_hash: originalHash,
          run_id: report.run_id,
          schema_version: "knowledge-distiller.manifest.v1",
          target_key: targetKey,
          target_path: path.resolve(note),
        }),
        "utf-8"
      );
      report.manifest = { path: manifestPath, sha256: fileHash(manifestPath) };
    }
    fs.writeFileSync(file, JSON.stringify(report), "utf-8");
    if (check(file).gate !== "failed") {
      throw new Error("unbound journal must fail closed");
    }
    const journalBase = {
      client_dispatch_id: "dispatch",
      cycle_id: "cycle-1",
      draft_hash: report.final_hash,
      evidence: { source: "self-test" },
      note_path: note,
      note_revision: 1,
      observability: "observed",
      observed_at: "2026-08-10T00:00:00Z",
      provider_operation_id: "provider",
      run_id: `${targetKey}/1`,
    };
    const journalEvents = [
      {
        ...journalBase,
        attempt_id: "clarity-1",
        attempt_state: "pending",
        axis: "clarity",
        event_id: "j1",
        event_type: "dispatch",
        order: 1,
      },
      {
        ...journalBase,
        attempt_id: "clarity-1",
        attempt_state: "running",
        axis: "clarity",
        event_id: "j2",
        event_type: "progress",
        order: 2,
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
        attempt_state: "completed",
        axis: "clarity",
        claims_checked: 3,
        event_id: "j3",
        event_type: "result",
        findings: [],
        order: 3,
        result: "clean",
        source_coverage: "complete",
        teach_back: "reader can explain",
        unverified: "—",
      },
      {
        ...journalBase,
        attempt_id: "accuracy-1",
        attempt_state: "pending",
        axis: "accuracy",
        event_id: "j4",
        event_type: "dispatch",
        order: 4,
      },
      {
        ...journalBase,
        attempt_id: "accuracy-1",
        attempt_state: "running",
        axis: "accuracy",
        event_id: "j5",
        event_type: "progress",
        order: 5,
      },
      {
        ...journalBase,
        A1: "—",
        after_state: "explain",
        attempt_id: "accuracy-1",
        attempt_state: "completed",
        axis: "accuracy",
        claims_checked: 3,
        event_id: "j6",
        event_type: "result",
        findings: [],
        order: 6,
        result: "clean",
        source_coverage: "complete",
        unverified: "—",
      },
      {
        ...journalBase,
        attempt_id: "run",
        axis: "system",
        close_order: 7,
        event_id: "j7",
        event_type: "report_closed",
        order: 7,
        review_budget: {
          max_attempts_per_axis_per_revision: 2,
          max_fallback_passes_per_axis: 1,
          max_revision_rounds: 2,
          revision_rounds: 0,
        },
      },
    ];
    fs.writeFileSync(
      journalPath,
      `${journalEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf-8"
    );
    report.review.journal = {
      close_order: 7,
      closed: true,
      events: 7,
      gate: "passed",
      path: journalPath,
      review_budget: {
        max_attempts_per_axis_per_revision: 2,
        max_fallback_passes_per_axis: 1,
        max_revision_rounds: 2,
        revision_rounds: 0,
      },
      run_id: report.run_id,
      sha256: fileHash(journalPath),
    };
    writeManifest("updated_note", "c".repeat(64));
    fs.writeFileSync(file, JSON.stringify(report), "utf-8");
    if (check(file).gate !== "passed") {
      throw new Error("hash-bound journal and final artifact should pass");
    }
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...report,
        schema_version: LEGACY_DELIVERY_SCHEMA_VERSION,
      }),
      "utf-8"
    );
    const legacyResult = check(file);
    if (
      legacyResult.gate !== "failed" ||
      !legacyResult.findings.some(
        (item) => item.code === "delivery-schema-legacy"
      )
    ) {
      throw new Error("legacy delivery.v2 must be rejected explicitly");
    }
    fs.writeFileSync(file, JSON.stringify(report), "utf-8");
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8")
    ) as Record<string, unknown>;
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, target_path: path.join(root, "Other.md") }),
      "utf-8"
    );
    report.manifest = { path: manifestPath, sha256: fileHash(manifestPath) };
    fs.writeFileSync(file, JSON.stringify(report), "utf-8");
    if (check(file).gate !== "failed") {
      throw new Error("manifest target drift must fail closed");
    }
    writeManifest("updated_note", "c".repeat(64));
    fs.writeFileSync(file, JSON.stringify(report), "utf-8");
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...report,
        run_id: "target-key/2",
      }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("delivery from another generation must fail");
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
    writeManifest("new_note", null);
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
    writeManifest("updated_note", "c".repeat(64));
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
          accuracy: { outcome: "provider_clean" },
          clarity: { outcome: "provider_clean" },
          journal: { close_order: 2, closed: true, events: 3, gate: "passed" },
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
            outcome: "manual_checked",
          },
          clarity: {
            outcome: "manual_checked",
          },
          journal: { closed: false, gate: "unavailable" },
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
        label: "未写入（仅草稿）",
        write_outcome: "updated",
        write_state: "idle",
      }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("write_outcome must not escape committed write_state");
    }
    fs.writeFileSync(
      file,
      JSON.stringify({ ...report, write_outcome: undefined }),
      "utf-8"
    );
    if (check(file).gate !== "failed") {
      throw new Error("committed write_state requires write_outcome");
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
  });
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
