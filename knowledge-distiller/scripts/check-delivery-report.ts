#!/usr/bin/env node
// Fail-closed validator for the machine-readable delivery decision.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evidence, exitForGate, fileHash, finding, isRecord, readJsonInput, nonEmptyString, type Evidence, type Finding } from "./lib/evidence.ts";

const WRITE_STATES = new Set(["written", "updated", "unchanged", "not_written", "possibly_partial"]);
const GATES = new Set(["passed", "failed", "unavailable", "not_applicable"]);
const REVIEW_RESULTS = new Set(["clean", "findings", "unverified", "protocol_invalid", "unavailable"]);
const REQUIRED_HARD_GATES = ["write_readback", "preservation", "heading", "mechanical_link", "semantic_link", "evidence", "render"];
const SUCCESS_LABELS = new Set(["双轴审查通过", "已交付；部分审查由人工复核", "已交付；存在未决项"]);
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
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function readJournalEvents(file: string): Array<Record<string, unknown>> {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function bindCreationProbe(report: Record<string, unknown>, findings: Finding[]): void {
  if (report.write_status !== "written" && report.write_status !== "updated") return;
  if (report.artifact_kind !== "new_note") return;
  const probe = isRecord(report.creation_probe) ? report.creation_probe : undefined;
  if (!probe || !nonEmptyString(probe.path) || !nonEmptyString(probe.target_path) || probe.target_existed !== false || path.resolve(String(probe.target_path)) !== path.resolve(String(report.note_path))) {
    findings.push(finding("delivery-creation-probe-missing", "error", "a written new_note must carry a creation probe proving the target was absent before the write"));
    return;
  }
  const probePath = path.resolve(String(probe.path));
  if (!fs.existsSync(probePath) || !fs.statSync(probePath).isFile()) {
    findings.push(finding("delivery-creation-probe-file-missing", "error", "creation_probe.path does not exist", { path: probePath }));
    return;
  }
  if (typeof probe.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(probe.sha256) || fileHash(probePath) !== probe.sha256) {
    findings.push(finding("delivery-creation-probe-hash-invalid", "error", "creation_probe.sha256 does not match its evidence file", { path: probePath }));
    return;
  }
  try {
    const evidence = JSON.parse(fs.readFileSync(probePath, "utf8")) as Record<string, unknown>;
    const notePath = path.resolve(String(report.note_path));
    const observedAt = typeof evidence.checked_at === "string" ? Date.parse(evidence.checked_at) : Number.NaN;
    if (evidence.schema_version !== "knowledge-distiller.creation-probe.v1" || evidence.target_path !== notePath || evidence.target_existed !== false || !Number.isFinite(observedAt)) findings.push(finding("delivery-creation-probe-content-invalid", "error", "creation probe does not prove absence of this exact target with a valid observation time", { path: probePath }));
    if (fs.statSync(probePath).mtimeMs > fs.statSync(notePath).mtimeMs) findings.push(finding("delivery-creation-probe-order-invalid", "error", "creation probe evidence must have been materialized before the final note write", { path: probePath, evidence: { probe_mtime: fs.statSync(probePath).mtimeMs, note_mtime: fs.statSync(notePath).mtimeMs } }));
  } catch (error) {
    findings.push(finding("delivery-creation-probe-json-invalid", "error", `creation probe is not valid JSON: ${(error as Error).message}`, { path: probePath }));
  }
}

function bindPassedJournal(journal: Record<string, unknown>, report: Record<string, unknown>, results: Record<string, string>, findings: Finding[]): void {
  if (journal.gate !== "passed") return;
  if (!nonEmptyString(journal.path)) {
    findings.push(finding("delivery-journal-path-missing", "error", "a passed review journal must identify its evidence file"));
    return;
  }
  const journalPath = path.resolve(String(journal.path));
  if (!fs.existsSync(journalPath) || !fs.statSync(journalPath).isFile()) {
    findings.push(finding("delivery-journal-file-missing", "error", "the passed review journal evidence file does not exist", { path: journalPath }));
    return;
  }
  if (typeof journal.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(journal.sha256)) {
    findings.push(finding("delivery-journal-hash-missing", "error", "a passed review journal must include its SHA-256"));
  } else if (fileHash(journalPath) !== journal.sha256) {
    findings.push(finding("delivery-journal-hash-mismatch", "error", "journal.sha256 does not match the evidence file", { path: journalPath, evidence: { actual: fileHash(journalPath), declared: journal.sha256 } }));
  }
  const child = spawnSync(process.execPath, [path.join(SCRIPT_DIR, "check-review-journal.ts"), "--journal", journalPath, "--json"], { encoding: "utf8" });
  let checked: Evidence | undefined;
  try {
    checked = JSON.parse(child.stdout ?? "") as Evidence;
  } catch {
    findings.push(finding("delivery-journal-check-invalid", "error", "the journal checker did not return a valid evidence envelope", { path: journalPath, evidence: { stdout: child.stdout ?? "", stderr: child.stderr ?? "" } }));
  }
  if (!checked || checked.gate !== "passed" || child.status !== 0) {
    findings.push(finding("delivery-journal-check-failed", "error", "the journal evidence does not pass its own closed-lifecycle checker", { path: journalPath, evidence: { gate: checked?.gate, exit_code: child.status } }));
  }
  if (checked?.metrics?.closed !== true || checked.metrics.events !== journal.events || checked.metrics.cutoff_order !== journal.cutoff_order) {
    findings.push(finding("delivery-journal-summary-mismatch", "error", "delivery journal summary does not match checker metrics", { path: journalPath, evidence: { declared: { events: journal.events, cutoff_order: journal.cutoff_order, closed: journal.closed }, checked: checked?.metrics } }));
  }
  let events: Array<Record<string, unknown>> = [];
  try {
    events = readJournalEvents(journalPath);
  } catch (error) {
    findings.push(finding("delivery-journal-events-invalid", "error", `could not read journal events: ${(error as Error).message}`, { path: journalPath }));
  }
  const notePath = nonEmptyString(report.note_path) ? path.resolve(String(report.note_path)) : "";
  for (const axis of ["clarity", "accuracy"] as const) {
    if (results[axis] !== "clean") continue;
    const reviewAxis = isRecord((report.review as Record<string, unknown> | undefined)?.[axis]) ? (report.review as Record<string, unknown>)[axis] as Record<string, unknown> : {};
    const matching = events.find((event) => event.axis === axis && event.quality_result === "clean" && event.cycle_id === reviewAxis.cycle_id && event.attempt_id === reviewAxis.attempt_id && event.note_revision === reviewAxis.note_revision && event.draft_hash === reviewAxis.draft_hash && event.note_path === notePath);
    if (!matching) {
      findings.push(finding("delivery-clean-review-unbound", "error", `review.${axis} clean result is not bound to a matching clean event in the checked journal`, { path: journalPath, evidence: { axis, attempt_id: reviewAxis.attempt_id, draft_hash: reviewAxis.draft_hash, note_path: notePath } }));
      continue;
    }
    const fields = axis === "clarity" ? ["source_coverage", "claims_checked", "after_state", "C1", "C2", "C3", "C4", "C5", "teach_back"] : ["source_coverage", "claims_checked", "after_state", "A1"];
    for (const field of fields) {
      if (String(matching[field] ?? "") !== String(reviewAxis[field] ?? "")) findings.push(finding("delivery-clean-review-summary-mismatch", "error", `review.${axis}.${field} does not match the bound journal event`, { path: journalPath, evidence: { axis, field, report: reviewAxis[field], journal: matching[field] } }));
    }
  }
}

function check(input: string): Evidence {
  const findings: Finding[] = [];
  let report: unknown;
  try {
    report = readJsonInput(input);
  } catch (error) {
    findings.push(finding("delivery-json-invalid", "error", `delivery report is not valid JSON: ${(error as Error).message}`));
    return evidence("check-delivery-report", "failed", { report: input }, {}, findings);
  }
  if (!isRecord(report)) {
    findings.push(finding("delivery-root-type", "error", "delivery report root must be an object"));
    return evidence("check-delivery-report", "failed", { report: input }, {}, findings);
  }
  if (report.schema_version !== "knowledge-distiller.delivery.v1") findings.push(finding("delivery-version-invalid", "error", "schema_version must be knowledge-distiller.delivery.v1"));
  if (!nonEmptyString(report.label)) findings.push(finding("delivery-label-missing", "error", "label is required"));
  else if (!DELIVERY_LABELS.has(String(report.label))) findings.push(finding("delivery-label-invalid", "error", "label is not in the canonical delivery matrix"));
  if (!WRITE_STATES.has(String(report.write_status))) findings.push(finding("delivery-write-state-invalid", "error", "write_status is not a canonical delivery state"));
  if (!nonEmptyString(report.note_path) && report.write_status !== "not_written") findings.push(finding("delivery-note-path-missing", "error", "note_path is required for a written or uncertain artifact"));
  const written = report.write_status === "written" || report.write_status === "updated";
  if (written) {
    if (!nonEmptyString(report.note_path) || !path.isAbsolute(String(report.note_path))) findings.push(finding("delivery-note-path-ambiguous", "error", "a written artifact must use an absolute note_path"));
    else if (!fs.existsSync(String(report.note_path)) || !fs.statSync(String(report.note_path)).isFile()) findings.push(finding("delivery-note-missing", "error", "the written note_path does not exist", { path: String(report.note_path) }));
    else if (typeof report.final_hash !== "string" || !/^[a-f0-9]{64}$/i.test(report.final_hash)) findings.push(finding("delivery-final-hash-missing", "error", "a written artifact must include a SHA-256 final_hash"));
    else if (fileHash(String(report.note_path)) !== report.final_hash) findings.push(finding("delivery-final-hash-mismatch", "error", "final_hash does not match the written note bytes", { path: String(report.note_path), evidence: { actual: fileHash(String(report.note_path)), declared: report.final_hash } }));
  }
  if (!new Set(["new_note", "updated_note"]).has(String(report.artifact_kind))) findings.push(finding("delivery-artifact-kind-invalid", "error", "artifact_kind must be new_note or updated_note"));

  const gateObject = isRecord(report.hard_gates) ? report.hard_gates : undefined;
  if (!gateObject) findings.push(finding("delivery-gates-missing", "error", "hard_gates must be an object"));
  const gateValues: string[] = [];
  for (const [name, value] of Object.entries(gateObject ?? {})) {
    if (!GATES.has(String(value))) findings.push(finding("delivery-gate-invalid", "error", `hard_gates.${name} has an unsupported status`));
    else gateValues.push(String(value));
    if (!REQUIRED_HARD_GATES.includes(name)) findings.push(finding("delivery-gate-unknown", "error", `hard_gates.${name} is not a canonical hard gate`));
  }
  if (gateObject && Object.keys(gateObject).length === 0) findings.push(finding("delivery-gates-empty", "error", "hard_gates must name every required hard gate"));
  for (const name of REQUIRED_HARD_GATES) {
    if (!gateObject || !(name in gateObject)) findings.push(finding("delivery-gate-missing", "error", `hard_gates.${name} is required`));
  }

  const review = isRecord(report.review) ? report.review : undefined;
  if (!review) findings.push(finding("delivery-review-missing", "error", "review must be an object"));
  const resultNames = ["clarity", "accuracy"] as const;
  const results: Record<string, string> = {};
  for (const name of resultNames) {
    const axis = isRecord(review?.[name]) ? review?.[name] as Record<string, unknown> : undefined;
    const result = String(axis?.quality_result ?? "");
    if (!REVIEW_RESULTS.has(result)) findings.push(finding("delivery-review-result-invalid", "error", `review.${name}.quality_result is missing or unsupported`));
    else results[name] = result;
    if (result === "clean") {
      for (const field of ["cycle_id", "attempt_id", "observability", "source_coverage", "claims_checked", "after_state", "draft_hash"]) {
        if (!nonEmptyString(axis?.[field]) && !(typeof axis?.[field] === "number" && Number(axis[field]) > 0)) findings.push(finding("delivery-clean-metadata-missing", "error", `review.${name}.${field} is required for quality_result=clean`));
      }
      if (!Number.isInteger(axis?.note_revision) || Number(axis.note_revision) < 0) findings.push(finding("delivery-clean-revision-invalid", "error", `review.${name}.note_revision must be a non-negative integer for quality_result=clean`));
      if (written && axis?.draft_hash !== report.final_hash) findings.push(finding("delivery-clean-hash-artifact-mismatch", "error", `review.${name}.draft_hash must equal final_hash for a written clean artifact`));
      if (axis?.source_coverage !== "complete") findings.push(finding("delivery-clean-coverage-invalid", "error", `review.${name}.source_coverage must be complete for quality_result=clean`));
      if (typeof axis?.draft_hash !== "string" || !/^[a-f0-9]{64}$/i.test(axis.draft_hash)) findings.push(finding("delivery-clean-hash-invalid", "error", `review.${name}.draft_hash must be SHA-256 for quality_result=clean`));
      const labels = name === "clarity" ? ["C1", "C2", "C3", "C4", "C5", "teach_back"] : ["A1"];
      for (const field of labels) if (!nonEmptyString(axis?.[field])) findings.push(finding("delivery-clean-review-contract-missing", "error", `review.${name}.${field} is required for quality_result=clean`));
    }
  }
  const manualFallback = review?.manual_fallback === true;
  for (const name of resultNames) {
    const axis = isRecord(review?.[name]) ? review?.[name] as Record<string, unknown> : undefined;
    if (axis?.fallback !== undefined && axis.fallback !== "manual_checked") findings.push(finding("delivery-fallback-invalid", "error", `review.${name}.fallback must be manual_checked when present`));
  }
  const journal = isRecord(review?.journal) ? review?.journal as Record<string, unknown> : undefined;
  if (!journal) findings.push(finding("delivery-journal-missing", "error", "review.journal must be an object"));
  if (journal && journal.gate !== "passed" && journal.gate !== "failed" && journal.gate !== "unavailable") findings.push(finding("delivery-journal-gate-invalid", "error", "review.journal.gate must be passed, failed, or unavailable"));
  if (journal?.gate === "passed" && journal.closed !== true) findings.push(finding("delivery-journal-open", "error", "a passed review journal must be closed"));
  if (journal?.gate === "passed" && (!(typeof journal.events === "number" && journal.events > 0) || !(typeof journal.cutoff_order === "number" && journal.cutoff_order > 0))) findings.push(finding("delivery-journal-evidence-missing", "error", "a passed review journal must include positive events and cutoff_order"));

  const blockers = Array.isArray(report.open_blockers) ? report.open_blockers : [];
  const openItems = Array.isArray(report.open_items) ? report.open_items : [];
  for (const item of [...blockers, ...openItems]) {
    if (!isRecord(item) || !new Set(["reader_blocker", "accuracy_blocker", "polish_item", "unverified"]).has(String(item.classification))) findings.push(finding("delivery-open-item-invalid", "error", "open items need a canonical classification"));
  }

  const label = String(report.label ?? "");
  const allHardPassed = gateValues.length > 0 && gateValues.every((value) => value === "passed" || value === "not_applicable");
  const bothClean = results.clarity === "clean" && results.accuracy === "clean";
  const journalClosed = journal?.gate === "passed" && journal.closed === true;
  const hasBlocker = blockers.length > 0 || openItems.some((item) => isRecord(item) && ["reader_blocker", "accuracy_blocker"].includes(String(item.classification)));
  const reviewUncertain = report.review_uncertain === true || journal?.gate === "failed" || ((journal?.gate === "unavailable") && !manualFallback);

  if (journal) bindPassedJournal(journal, report, results, findings);
  bindCreationProbe(report, findings);
  if (report.hard_gates && report.hard_gates.preservation === "not_applicable" && report.artifact_kind !== "new_note") {
    findings.push(finding("delivery-preservation-not-applicable-invalid", "error", "preservation=not_applicable is valid only for a new_note artifact"));
  }
  if (written && report.hard_gates && report.hard_gates.write_readback !== "passed") findings.push(finding("delivery-write-readback-required", "error", "a written or updated artifact must have write_readback=passed"));
  if (report.artifact_kind === "new_note" && report.hard_gates && report.hard_gates.preservation === "passed") {
    findings.push(finding("delivery-new-note-preservation-misclassified", "error", "a new_note should report preservation=not_applicable, not a fabricated update check"));
  }

  if (label === "双轴审查通过" && !(written && allHardPassed && bothClean && journalClosed && !hasBlocker && !reviewUncertain)) {
    findings.push(finding("delivery-success-overclaim", "error", "双轴审查通过 requires confirmed write, all hard gates passed, both valid clean results, closed journal, and no blockers"));
  }
  if (SUCCESS_LABELS.has(label) && !written) findings.push(finding("delivery-write-overclaim", "error", "a success delivery label requires write_status written or updated"));
  if (written && !allHardPassed && SUCCESS_LABELS.has(label)) findings.push(finding("delivery-gate-overclaim", "error", "a success delivery label cannot hide failed or unavailable hard gates"));
  if (reviewUncertain && SUCCESS_LABELS.has(label)) findings.push(finding("delivery-review-overclaim", "error", "an uncertain review state cannot use a success delivery label"));
  if (hasBlocker && SUCCESS_LABELS.has(label)) findings.push(finding("delivery-blocker-overclaim", "error", "reader/accuracy blockers cannot use a success delivery label"));
  if (label === "已交付；部分审查由人工复核" && !(manualFallback && journal?.gate === "unavailable" && results.clarity === "unavailable" && results.accuracy === "unavailable" && review?.clarity?.fallback === "manual_checked" && review?.accuracy?.fallback === "manual_checked" && !hasBlocker)) {
    findings.push(finding("delivery-manual-fallback-overclaim", "error", "partial manual-review delivery requires explicit manual_checked fallback for both unavailable axes"));
  }
  if (label === "已交付；存在未决项" && openItems.some((item) => isRecord(item) && ["reader_blocker", "accuracy_blocker"].includes(String(item.classification)))) {
    findings.push(finding("delivery-open-blocker-overclaim", "error", "存在未决项 cannot contain reader or accuracy blockers"));
  }
  if (report.write_status === "possibly_partial" && !label.includes("不确定")) findings.push(finding("delivery-partial-overclaim", "error", "possibly_partial writes must be reported as uncertain"));
  if (report.write_status === "not_written" && SUCCESS_LABELS.has(label)) findings.push(finding("delivery-not-written-overclaim", "error", "not_written cannot use a success delivery label"));

  const errors = findings.filter((item) => item.severity === "error");
  return evidence("check-delivery-report", errors.length === 0 ? "passed" : "failed", { report: input }, {
    write_status: report.write_status,
    label,
    all_hard_gates_passed: allHardPassed,
    both_clean: bothClean,
    journal_closed: journalClosed,
    blocker_count: blockers.length,
    open_item_count: openItems.length,
  }, findings);
}

function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-delivery-"));
  try {
    const file = path.join(root, "report.json");
    const report = {
      schema_version: "knowledge-distiller.delivery.v1",
      label: "双轴审查通过",
      write_status: "updated",
      note_path: "/tmp/Note.md",
      hard_gates: { write_readback: "passed", preservation: "passed", heading: "passed", mechanical_link: "passed", semantic_link: "passed", evidence: "passed", render: "passed" },
      review: {
        clarity: { quality_result: "clean", cycle_id: "cycle-1", attempt_id: "clarity-1", note_revision: 1, observability: "provider", source_coverage: "complete", claims_checked: 3, after_state: "explain", draft_hash: "a".repeat(64), C1: "—", C2: "—", C3: "—", C4: "—", C5: "—", teach_back: "reader can explain" },
        accuracy: { quality_result: "clean", cycle_id: "cycle-1", attempt_id: "accuracy-1", note_revision: 1, observability: "provider", source_coverage: "complete", claims_checked: 3, after_state: "explain", draft_hash: "a".repeat(64), A1: "—" },
        journal: { gate: "passed", closed: true, events: 3, cutoff_order: 2 },
      },
      open_blockers: [],
      open_items: [],
      artifact_kind: "updated_note",
      final_hash: "b".repeat(64),
    };
    const note = path.join(root, "Note.md");
    fs.writeFileSync(note, "# Note\n", "utf8");
    report.note_path = note;
    report.final_hash = fileHash(note);
    report.review.clarity.draft_hash = report.final_hash;
    report.review.accuracy.draft_hash = report.final_hash;
    fs.writeFileSync(file, JSON.stringify(report), "utf8");
    if (check(file).gate !== "failed") throw new Error("unbound journal must fail closed");
    const journalPath = path.join(root, "journal.jsonl");
    const journalBase = { cycle_id: "cycle-1", note_path: note, note_revision: 1, draft_hash: report.final_hash, client_dispatch_id: "dispatch", provider_operation_id: "provider", observed_at: "2026-08-10T00:00:00Z", observability: "self-test", evidence: { source: "self-test" }, provider_execution_state: "pending", provider_liveness: "unobserved", parent_wait_state: "waiting", cancel_state: "not_requested" };
    const journalEvents = [
      { ...journalBase, event_id: "j1", order: 1, event_type: "dispatch", attempt_id: "clarity-1", axis: "clarity", state_before: "pending", state_after: "active", quality_result: "unavailable" },
      { ...journalBase, event_id: "j2", order: 2, event_type: "result", attempt_id: "clarity-1", axis: "clarity", state_before: "active", state_after: "completed", provider_execution_state: "completed", provider_liveness: "terminal", quality_result: "clean", source_coverage: "complete", claims_checked: 3, after_state: "explain", C1: "—", C2: "—", C3: "—", C4: "—", C5: "—", teach_back: "reader can explain", findings: [], unverified: "—" },
      { ...journalBase, event_id: "j3", order: 3, event_type: "dispatch", attempt_id: "accuracy-1", axis: "accuracy", state_before: "pending", state_after: "active", quality_result: "unavailable" },
      { ...journalBase, event_id: "j4", order: 4, event_type: "result", attempt_id: "accuracy-1", axis: "accuracy", state_before: "active", state_after: "completed", provider_execution_state: "completed", provider_liveness: "terminal", quality_result: "clean", source_coverage: "complete", claims_checked: 3, after_state: "explain", A1: "—", findings: [], unverified: "—" },
      { ...journalBase, event_id: "j5", order: 5, event_type: "report_closed", attempt_id: "close-1", axis: "system", state_before: "completed", state_after: "closed", parent_wait_state: "closed", quality_result: "unavailable", cutoff_order: 4 },
    ];
    fs.writeFileSync(journalPath, journalEvents.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
    report.review.journal = { gate: "passed", closed: true, events: 5, cutoff_order: 4, path: journalPath, sha256: fileHash(journalPath) };
    fs.writeFileSync(file, JSON.stringify(report), "utf8");
    if (check(file).gate !== "passed") throw new Error("hash-bound journal and final artifact should pass");
    const probePath = path.join(root, "creation-probe.json");
    fs.writeFileSync(probePath, JSON.stringify({ schema_version: "knowledge-distiller.creation-probe.v1", target_path: note, target_existed: false, checked_at: "2026-08-10T00:00:00Z" }), "utf8");
    const noteAfterProbe = new Date(Date.now() + 1000);
    fs.utimesSync(note, noteAfterProbe, noteAfterProbe);
    const newReport = { ...report, artifact_kind: "new_note", hard_gates: { ...report.hard_gates, preservation: "not_applicable" }, creation_probe: { path: probePath, sha256: fileHash(probePath), target_path: note, target_existed: false } };
    fs.writeFileSync(file, JSON.stringify(newReport), "utf8");
    if (check(file).gate !== "passed") throw new Error("a new note with a bound creation probe should pass");
    fs.writeFileSync(file, JSON.stringify({ ...newReport, creation_probe: undefined }), "utf8");
    if (check(file).gate !== "failed") throw new Error("a new note without a creation probe must fail");
    fs.writeFileSync(file, JSON.stringify({ ...report, review: { ...report.review, clarity: { ...report.review.clarity, C1: "fabricated summary" } } }), "utf8");
    if (check(file).gate !== "failed") throw new Error("clean summary fields must match the bound journal event");
    fs.writeFileSync(file, JSON.stringify({
      ...report,
      review: { clarity: { quality_result: "clean" }, accuracy: { quality_result: "clean" }, journal: { gate: "passed", closed: true, events: 3, cutoff_order: 2 } },
    }), "utf8");
    if (check(file).gate !== "failed") throw new Error("clean axes without reviewer metadata should fail");
    fs.writeFileSync(file, JSON.stringify({ ...report, hard_gates: { bogus: "passed" } }), "utf8");
    if (check(file).gate !== "failed") throw new Error("incomplete hard-gate set should fail");
    fs.writeFileSync(file, JSON.stringify({ ...report, label: "假的通过标签" }), "utf8");
    if (check(file).gate !== "failed") throw new Error("unknown delivery label should fail");
    fs.writeFileSync(file, JSON.stringify({
      ...report,
      label: "已交付；部分审查由人工复核",
      review: {
        clarity: { quality_result: "unavailable", fallback: "manual_checked" },
        accuracy: { quality_result: "unavailable", fallback: "manual_checked" },
        manual_fallback: true,
        journal: { gate: "unavailable", closed: false },
      },
    }), "utf8");
    if (check(file).gate !== "passed") throw new Error("explicit two-axis manual fallback should pass");
    fs.writeFileSync(file, JSON.stringify({ ...report, artifact_kind: "updated_note", hard_gates: { ...report.hard_gates, preservation: "not_applicable" } }), "utf8");
    if (check(file).gate !== "failed") throw new Error("not_applicable preservation must be restricted to new notes");
    fs.writeFileSync(file, JSON.stringify({ ...report, hard_gates: { ...report.hard_gates, write_readback: "failed" } }), "utf8");
    if (check(file).gate !== "failed") throw new Error("failed hard gate must reject clean delivery");
    console.log("delivery-report checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const json = args.includes("--json");
  let report = "";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--report") report = args[++i] ?? "";
    else if (!["--json", "--help", "-h"].includes(args[i])) throw new Error(`unknown argument: ${args[i]}`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/check-delivery-report.ts --report REPORT.json [--json]");
    console.log("       node scripts/check-delivery-report.ts --self-test");
    return 0;
  }
  if (!report) throw new Error("usage: node scripts/check-delivery-report.ts --report REPORT.json");
  const result = check(report);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.gate === "passed") console.log("OK: delivery label is consistent with write, gate, and review evidence");
  else result.findings.filter((item) => item.severity === "error").forEach((item) => console.error(`ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`));
  return exitForGate(result.gate);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
