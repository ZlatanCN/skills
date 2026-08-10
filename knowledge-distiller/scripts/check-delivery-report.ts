#!/usr/bin/env node
// Fail-closed validator for the machine-readable delivery decision.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { evidence, exitForGate, finding, isRecord, readJsonInput, nonEmptyString, type Evidence, type Finding } from "./lib/evidence.ts";

const WRITE_STATES = new Set(["written", "updated", "unchanged", "not_written", "possibly_partial"]);
const GATES = new Set(["passed", "failed", "unavailable"]);
const REVIEW_RESULTS = new Set(["clean", "findings", "unverified", "protocol_invalid", "unavailable", "manual_checked"]);
const SUCCESS_LABELS = new Set(["双轴审查通过", "已交付；部分审查由人工复核", "已交付；存在未决项"]);

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
  if (!WRITE_STATES.has(String(report.write_status))) findings.push(finding("delivery-write-state-invalid", "error", "write_status is not a canonical delivery state"));
  if (!nonEmptyString(report.note_path) && report.write_status !== "not_written") findings.push(finding("delivery-note-path-missing", "error", "note_path is required for a written or uncertain artifact"));

  const gateObject = isRecord(report.hard_gates) ? report.hard_gates : undefined;
  if (!gateObject) findings.push(finding("delivery-gates-missing", "error", "hard_gates must be an object"));
  const gateValues: string[] = [];
  for (const [name, value] of Object.entries(gateObject ?? {})) {
    if (!GATES.has(String(value))) findings.push(finding("delivery-gate-invalid", "error", `hard_gates.${name} has an unsupported status`));
    else gateValues.push(String(value));
  }
  if (gateObject && Object.keys(gateObject).length === 0) findings.push(finding("delivery-gates-empty", "error", "hard_gates must name every required hard gate"));

  const review = isRecord(report.review) ? report.review : undefined;
  if (!review) findings.push(finding("delivery-review-missing", "error", "review must be an object"));
  const resultNames = ["clarity", "accuracy"] as const;
  const results: Record<string, string> = {};
  for (const name of resultNames) {
    const axis = isRecord(review?.[name]) ? review?.[name] as Record<string, unknown> : undefined;
    const result = String(axis?.quality_result ?? "");
    if (!REVIEW_RESULTS.has(result)) findings.push(finding("delivery-review-result-invalid", "error", `review.${name}.quality_result is missing or unsupported`));
    else results[name] = result;
  }
  const journal = isRecord(review?.journal) ? review?.journal as Record<string, unknown> : undefined;
  if (!journal) findings.push(finding("delivery-journal-missing", "error", "review.journal must be an object"));
  if (journal && journal.gate !== "passed" && journal.gate !== "failed" && journal.gate !== "unavailable") findings.push(finding("delivery-journal-gate-invalid", "error", "review.journal.gate must be passed, failed, or unavailable"));
  if (journal?.gate === "passed" && journal.closed !== true) findings.push(finding("delivery-journal-open", "error", "a passed review journal must be closed"));

  const blockers = Array.isArray(report.open_blockers) ? report.open_blockers : [];
  const openItems = Array.isArray(report.open_items) ? report.open_items : [];
  for (const item of [...blockers, ...openItems]) {
    if (!isRecord(item) || !new Set(["reader_blocker", "accuracy_blocker", "polish_item", "unverified"]).has(String(item.classification))) findings.push(finding("delivery-open-item-invalid", "error", "open items need a canonical classification"));
  }

  const label = String(report.label ?? "");
  const written = report.write_status === "written" || report.write_status === "updated";
  const allHardPassed = gateValues.length > 0 && gateValues.every((value) => value === "passed");
  const bothClean = results.clarity === "clean" && results.accuracy === "clean";
  const journalClosed = journal?.gate === "passed" && journal.closed === true;
  const hasBlocker = blockers.length > 0 || openItems.some((item) => isRecord(item) && ["reader_blocker", "accuracy_blocker"].includes(String(item.classification)));
  const reviewUncertain = report.review_uncertain === true || journal?.gate === "unavailable";

  if (label === "双轴审查通过" && !(written && allHardPassed && bothClean && journalClosed && !hasBlocker && !reviewUncertain)) {
    findings.push(finding("delivery-success-overclaim", "error", "双轴审查通过 requires confirmed write, all hard gates passed, both valid clean results, closed journal, and no blockers"));
  }
  if (SUCCESS_LABELS.has(label) && !written) findings.push(finding("delivery-write-overclaim", "error", "a success delivery label requires write_status written or updated"));
  if (written && !allHardPassed && SUCCESS_LABELS.has(label)) findings.push(finding("delivery-gate-overclaim", "error", "a success delivery label cannot hide failed or unavailable hard gates"));
  if (reviewUncertain && SUCCESS_LABELS.has(label)) findings.push(finding("delivery-review-overclaim", "error", "an uncertain review state cannot use a success delivery label"));
  if (hasBlocker && SUCCESS_LABELS.has(label)) findings.push(finding("delivery-blocker-overclaim", "error", "reader/accuracy blockers cannot use a success delivery label"));
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
      hard_gates: { read_back: "passed", heading: "passed", links: "passed", format_plan: "passed" },
      review: { clarity: { quality_result: "clean" }, accuracy: { quality_result: "clean" }, journal: { gate: "passed", closed: true } },
      open_blockers: [],
      open_items: [],
    };
    fs.writeFileSync(file, JSON.stringify(report), "utf8");
    if (check(file).gate !== "passed") throw new Error("valid delivery report should pass");
    fs.writeFileSync(file, JSON.stringify({ ...report, hard_gates: { read_back: "failed" } }), "utf8");
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

