#!/usr/bin/env node
// Checks the small final delivery record. It does not create or manage run artifacts.

import * as fs from "node:fs";

import {
  evidence,
  exitForGate,
  fileHash,
  finding,
  isRecord,
  readJsonInput,
  runMain,
  withTempDir,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";

const REVIEW_RESULTS = new Set([
  "clean",
  "findings",
  "unavailable",
  "manual_checked",
]);
const WRITE_STATES = new Set(["committed", "uncertain", "not_written"]);
const SUCCESS_LABELS = new Set(["delivered", "双轴审查通过", "已交付"]);
// ponytail: no run bundle or event journal; add one only for concurrent writers or recovery audits.

function validateCommittedDelivery(
  report: Record<string, unknown>,
  state: string,
  notePath: string,
  finalHash: string
): Finding[] {
  if (state !== "committed") {
    return [];
  }
  const findings: Finding[] = [];
  if (
    !notePath ||
    !fs.existsSync(notePath) ||
    !fs.statSync(notePath).isFile()
  ) {
    findings.push(
      finding(
        "note-missing",
        "error",
        "committed delivery must name an existing note",
        { path: notePath }
      )
    );
  } else if (!finalHash || fileHash(notePath) !== finalHash) {
    findings.push(
      finding(
        "final-hash-mismatch",
        "error",
        "final_hash does not match the read-back note",
        { path: notePath }
      )
    );
  }
  if (
    !new Set(["created", "updated", "unchanged"]).has(
      String(report.write_outcome ?? "")
    )
  ) {
    findings.push(
      finding(
        "write-outcome",
        "error",
        "committed delivery needs created, updated, or unchanged"
      )
    );
  }
  return findings;
}

function validateReviews(review: Record<string, unknown>): {
  findings: Finding[];
  bothClean: boolean;
} {
  const findings: Finding[] = [];
  for (const axis of ["clarity", "accuracy"]) {
    const item = isRecord(review[axis]) ? review[axis] : {};
    if (!REVIEW_RESULTS.has(String(item.result ?? ""))) {
      findings.push(
        finding(
          "review-result",
          "error",
          `${axis} review result is missing or invalid`
        )
      );
    }
  }
  return {
    bothClean: ["clarity", "accuracy"].every(
      (axis) => isRecord(review[axis]) && review[axis].result === "clean"
    ),
    findings,
  };
}

function check(reportPath: string): Evidence {
  const findings: Finding[] = [];
  let report: Record<string, unknown>;
  try {
    const value = readJsonInput(reportPath);
    if (!isRecord(value)) {
      throw new Error("report must be an object");
    }
    report = value;
  } catch (error) {
    return evidence(
      "check-delivery-report",
      "unavailable",
      { report: reportPath },
      {},
      [finding("report-invalid", "error", (error as Error).message)]
    );
  }

  if (report.schema_version !== "knowledge-distiller.delivery.v1") {
    findings.push(
      finding(
        "schema-version",
        "error",
        "expected knowledge-distiller.delivery.v1"
      )
    );
  }
  const state = String(report.write_state ?? "");
  if (!WRITE_STATES.has(state)) {
    findings.push(finding("write-state", "error", "write_state is invalid"));
  }

  const notePath = typeof report.note_path === "string" ? report.note_path : "";
  const finalHash =
    typeof report.final_hash === "string" ? report.final_hash : "";
  findings.push(
    ...validateCommittedDelivery(report, state, notePath, finalHash)
  );

  const review = isRecord(report.review) ? report.review : {};
  const reviewResult = validateReviews(review);
  findings.push(...reviewResult.findings);
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  if (
    SUCCESS_LABELS.has(String(report.label ?? "")) &&
    (state !== "committed" || !reviewResult.bothClean || blockers.length > 0)
  ) {
    findings.push(
      finding(
        "success-overclaim",
        "error",
        "success label requires committed write, two clean reviews, and no blockers"
      )
    );
  }

  return evidence(
    "check-delivery-report",
    findings.length === 0 ? "passed" : "failed",
    { final_hash: finalHash, note_path: notePath, report: reportPath },
    { blockers: blockers.length, reviews_clean: reviewResult.bothClean },
    findings
  );
}

function selfTest(): number {
  return withTempDir("knowledge-distiller-delivery-", (root) => {
    const note = `${root}/Note.md`;
    fs.writeFileSync(note, "# Note\n", "utf-8");
    const report = `${root}/delivery.json`;
    fs.writeFileSync(
      report,
      JSON.stringify({
        blockers: [],
        final_hash: fileHash(note),
        label: "delivered",
        note_path: note,
        review: { accuracy: { result: "clean" }, clarity: { result: "clean" } },
        schema_version: "knowledge-distiller.delivery.v1",
        write_outcome: "created",
        write_state: "committed",
      }),
      "utf-8"
    );
    if (check(report).gate !== "passed") {
      throw new Error("valid delivery should pass");
    }
    console.log("delivery checker self-test: PASS");
    return 0;
  });
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    return selfTest();
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: node scripts/check-delivery-report.ts --report REPORT.json [--json]"
    );
    return 0;
  }
  const index = args.indexOf("--report");
  const report = index === -1 ? "" : args[index + 1];
  if (report === undefined || report === "") {
    throw new Error("--report is required");
  }
  const result = check(report);
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      result.gate === "passed"
        ? "OK: delivery report passed"
        : `DELIVERY CHECK ${result.gate}`
    );
  }
  return exitForGate(result.gate);
}

runMain(main);
