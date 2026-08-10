#!/usr/bin/env node
// Verifies byte identity and mechanical coverage of an update diff. It does not judge whether an operation is wise.

import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import {
  fileHash,
  evidence,
  exitForGate,
  finding,
  isRecord,
  readJsonInput,
  runMain,
  nonEmptyString,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";

const OPERATIONS = new Set([
  "keep",
  "rewrite",
  "move",
  "merge",
  "split",
  "delete",
  "defer",
  "add",
]);

type Hunk = {
  original_start: number;
  original_end: number;
  draft_start: number;
  draft_end: number;
};

function lines(file: string): string[] {
  return fs.readFileSync(file, "utf-8").split(/\r?\n/u);
}

function diffHunks(original: string[], draft: string[]): Hunk[] {
  const rows = Array.from(
    { length: original.length + 1 },
    () => new Uint32Array(draft.length + 1)
  );
  for (let i = original.length - 1; i >= 0; i -= 1) {
    for (let j = draft.length - 1; j >= 0; j -= 1) {
      rows[i][j] =
        original[i] === draft[j]
          ? rows[i + 1][j + 1] + 1
          : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let startI = -1;
  let startJ = -1;
  function close(): void {
    if (startI < 0) {
      return;
    }
    hunks.push({
      draft_end: startJ < j ? j : 0,
      draft_start: startJ < j ? startJ + 1 : 0,
      original_end: startI < i ? i : 0,
      original_start: startI < i ? startI + 1 : 0,
    });
    startI = -1;
    startJ = -1;
  }
  while (i < original.length || j < draft.length) {
    if (i < original.length && j < draft.length && original[i] === draft[j]) {
      close();
      i += 1;
      j += 1;
      continue;
    }
    if (startI < 0) {
      startI = i;
      startJ = j;
    }
    if (i >= original.length) {
      j += 1;
    } else if (j >= draft.length) {
      i += 1;
    } else if (rows[i + 1][j] >= rows[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  close();
  return hunks;
}

function rangeCovers(unit: Record<string, unknown>, hunk: Hunk): boolean {
  const oi = Number(unit.original_start ?? 0);
  const oe = Number(unit.original_end ?? 0);
  const di = Number(unit.draft_start ?? 0);
  const de = Number(unit.draft_end ?? 0);
  const originalCovered =
    oi === hunk.original_start && oe === hunk.original_end;
  const draftCovered = di === hunk.draft_start && de === hunk.draft_end;
  return originalCovered && draftCovered;
}

function validRange(start: number, end: number, max: number): boolean {
  return (
    (start === 0 && end === 0) || (start > 0 && end >= start && end <= max)
  );
}

function validateRecordMetadata(
  record: Record<string, unknown>,
  originalInput: string | undefined,
  draftInput: string | undefined,
  findings: Finding[]
): void {
  if (record.schema_version !== "knowledge-distiller.preservation.v1") {
    findings.push(
      finding(
        "preservation-version-invalid",
        "error",
        "schema_version must be knowledge-distiller.preservation.v1"
      )
    );
  }
  if (
    !new Set(["targeted_update", "full_recompose"]).has(String(record.scope))
  ) {
    findings.push(
      finding(
        "preservation-scope-invalid",
        "error",
        "scope must be targeted_update or full_recompose"
      )
    );
  }
  if (
    !nonEmptyString(record.original_hash) ||
    !nonEmptyString(record.draft_hash)
  ) {
    findings.push(
      finding(
        "preservation-hash-missing",
        "error",
        "original_hash and draft_hash are required"
      )
    );
  }
  if (!originalInput || !draftInput) {
    findings.push(
      finding(
        "preservation-path-missing",
        "error",
        "original and draft paths are required"
      )
    );
  }
}

function loadDiff(
  record: Record<string, unknown>,
  originalInput: string | undefined,
  draftInput: string | undefined,
  findings: Finding[]
): { draftLineCount: number; hunks: Hunk[]; originalLineCount: number } {
  let hunks: Hunk[] = [];
  let originalLineCount = 0;
  let draftLineCount = 0;
  if (!originalInput || !draftInput) {
    return { draftLineCount, hunks, originalLineCount };
  }
  const original = path.resolve(originalInput);
  const draft = path.resolve(draftInput);
  const originalExists =
    fs.existsSync(original) && fs.statSync(original).isFile();
  const draftExists = fs.existsSync(draft) && fs.statSync(draft).isFile();
  if (!originalExists) {
    findings.push(
      finding(
        "preservation-original-missing",
        "error",
        "original file does not exist",
        {
          path: original,
        }
      )
    );
  }
  if (!draftExists) {
    findings.push(
      finding(
        "preservation-draft-missing",
        "error",
        "draft file does not exist",
        {
          path: draft,
        }
      )
    );
  }
  if (!originalExists || !draftExists) {
    return { draftLineCount, hunks, originalLineCount };
  }
  const originalHash = fileHash(original);
  const draftHash = fileHash(draft);
  if (record.original_hash !== originalHash) {
    findings.push(
      finding(
        "preservation-original-hash-mismatch",
        "error",
        "original_hash does not match original bytes",
        {
          evidence: { actual: record.original_hash, expected: originalHash },
          path: original,
        }
      )
    );
  }
  if (record.draft_hash !== draftHash) {
    findings.push(
      finding(
        "preservation-draft-hash-mismatch",
        "error",
        "draft_hash does not match draft bytes",
        {
          evidence: { actual: record.draft_hash, expected: draftHash },
          path: draft,
        }
      )
    );
  }
  const originalLines = lines(original);
  const draftLines = lines(draft);
  originalLineCount = originalLines.length;
  draftLineCount = draftLines.length;
  if (originalLineCount * draftLineCount > 25_000_000) {
    findings.push(
      finding(
        "preservation-too-large",
        "error",
        "line diff is too large for the bounded checker; use a smaller revision or manual fallback",
        {
          evidence: {
            draft_lines: draftLineCount,
            original_lines: originalLineCount,
          },
        }
      )
    );
  } else {
    hunks = diffHunks(originalLines, draftLines);
  }
  return { draftLineCount, hunks, originalLineCount };
}

function validateUnits(
  value: unknown,
  originalLineCount: number,
  draftLineCount: number,
  findings: Finding[]
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    findings.push(
      finding(
        "preservation-units-type",
        "error",
        "changed_units must be an array"
      )
    );
    return [];
  }
  const units: Record<string, unknown>[] = [];
  for (const [index, unit] of value.entries()) {
    if (!isRecord(unit)) {
      findings.push(
        finding(
          "preservation-unit-type",
          "error",
          `changed_units[${index}] must be an object`
        )
      );
      continue;
    }
    units.push(unit);
    if (!OPERATIONS.has(String(unit.operation))) {
      findings.push(
        finding(
          "preservation-operation-invalid",
          "error",
          `changed_units[${index}].operation is not canonical`
        )
      );
    }
    if (!nonEmptyString(unit.reason)) {
      findings.push(
        finding(
          "preservation-reason-missing",
          "error",
          `changed_units[${index}].reason is required`
        )
      );
    }
    for (const field of [
      "original_start",
      "original_end",
      "draft_start",
      "draft_end",
    ]) {
      if (!Number.isInteger(unit[field]) || Number(unit[field]) < 0) {
        findings.push(
          finding(
            "preservation-range-invalid",
            "error",
            `changed_units[${index}].${field} must be a non-negative integer`
          )
        );
      }
    }
    const originalStart = Number(unit.original_start ?? 0);
    const originalEnd = Number(unit.original_end ?? 0);
    const draftStart = Number(unit.draft_start ?? 0);
    const draftEnd = Number(unit.draft_end ?? 0);
    if (
      !validRange(originalStart, originalEnd, originalLineCount) ||
      !validRange(draftStart, draftEnd, draftLineCount)
    ) {
      findings.push(
        finding(
          "preservation-range-out-of-bounds",
          "error",
          `changed_units[${index}] is outside the actual line counts`,
          {
            evidence: {
              draft_end: draftEnd,
              draft_lines: draftLineCount,
              draft_start: draftStart,
              original_end: originalEnd,
              original_lines: originalLineCount,
              original_start: originalStart,
            },
          }
        )
      );
    }
  }
  return units;
}

function validateCoverage(
  hunks: Hunk[],
  units: Record<string, unknown>[],
  findings: Finding[]
): void {
  for (const hunk of hunks) {
    if (!units.some((unit) => rangeCovers(unit, hunk))) {
      findings.push(
        finding(
          "preservation-hunk-uncovered",
          "error",
          "an actual changed line hunk is missing from changed_units",
          { evidence: hunk }
        )
      );
    }
  }
  if (hunks.length === 0 && units.length > 0) {
    findings.push(
      finding(
        "preservation-spurious-unit",
        "error",
        "changed_units claims changes but original and draft have no line diff"
      )
    );
  }
}

function check(
  recordInput: string,
  originalInput?: string,
  draftInput?: string
): Evidence {
  const findings: Finding[] = [];
  let record: unknown;
  try {
    record = readJsonInput(recordInput);
  } catch (error) {
    findings.push(
      finding(
        "preservation-json-invalid",
        "error",
        `preservation record is not valid JSON: ${(error as Error).message}`
      )
    );
    return evidence(
      "check-preservation",
      "failed",
      { draft: draftInput, original: originalInput, record: recordInput },
      {},
      findings
    );
  }
  if (!isRecord(record)) {
    findings.push(
      finding(
        "preservation-root-type",
        "error",
        "preservation record root must be an object"
      )
    );
    return evidence(
      "check-preservation",
      "failed",
      { record: recordInput },
      {},
      findings
    );
  }
  validateRecordMetadata(record, originalInput, draftInput, findings);
  const { draftLineCount, hunks, originalLineCount } = loadDiff(
    record,
    originalInput,
    draftInput,
    findings
  );
  const units = validateUnits(
    record.changed_units,
    originalLineCount,
    draftLineCount,
    findings
  );
  validateCoverage(hunks, units, findings);

  const errors = findings.filter((item) => item.severity === "error");
  return evidence(
    "check-preservation",
    errors.length === 0 ? "passed" : "failed",
    {
      draft: draftInput ? path.resolve(draftInput) : undefined,
      original: originalInput ? path.resolve(originalInput) : undefined,
      record: recordInput,
    },
    {
      actual_change_hunks: hunks.length,
      draft_hash: record.draft_hash,
      original_hash: record.original_hash,
      recorded_changed_units: units.length,
    },
    findings
  );
}

function selfTest(): number {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-distiller-preservation-")
  );
  try {
    const original = path.join(root, "original.md");
    const draft = path.join(root, "draft.md");
    fs.writeFileSync(original, "# Main\nold\nkeep\n", "utf-8");
    fs.writeFileSync(draft, "# Main\nnew\nkeep\n", "utf-8");
    const record = path.join(root, "record.json");
    fs.writeFileSync(
      record,
      JSON.stringify({
        changed_units: [
          {
            draft_end: 2,
            draft_start: 2,
            operation: "rewrite",
            original_end: 2,
            original_start: 2,
            reason: "corrected wording",
          },
        ],
        draft_hash: fileHash(draft),
        original_hash: fileHash(original),
        schema_version: "knowledge-distiller.preservation.v1",
        scope: "targeted_update",
      }),
      "utf-8"
    );
    if (check(record, original, draft).gate !== "passed") {
      throw new Error("valid preservation record should pass");
    }
    fs.writeFileSync(
      record,
      JSON.stringify({
        ...JSON.parse(fs.readFileSync(record, "utf-8")),
        changed_units: [],
      }),
      "utf-8"
    );
    if (check(record, original, draft).gate !== "failed") {
      throw new Error("uncovered diff should fail");
    }
    fs.writeFileSync(
      record,
      JSON.stringify({
        changed_units: [
          {
            draft_end: 999_999,
            draft_start: 1,
            operation: "rewrite",
            original_end: 999_999,
            original_start: 1,
            reason: "invalid range",
          },
        ],
        draft_hash: fileHash(draft),
        original_hash: fileHash(original),
        schema_version: "knowledge-distiller.preservation.v1",
        scope: "targeted_update",
      }),
      "utf-8"
    );
    if (check(record, original, draft).gate !== "failed") {
      throw new Error("out-of-bounds range should fail");
    }
    console.log("preservation checker self-test: PASS");
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
  let record = "";
  let original = "";
  let draft = "";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--record") {
      i += 1;
      record = args[i] ?? "";
    } else if (args[i] === "--original") {
      i += 1;
      original = args[i] ?? "";
    } else if (args[i] === "--draft") {
      i += 1;
      draft = args[i] ?? "";
    } else if (!["--json", "--help", "-h"].includes(args[i])) {
      throw new Error(`unknown argument: ${args[i]}`);
    }
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: node scripts/check-preservation.ts --record RECORD.json --original ORIGINAL.md --draft DRAFT.md [--json]"
    );
    console.log("       node scripts/check-preservation.ts --self-test");
    return 0;
  }
  if (!record || !original || !draft) {
    throw new Error(
      "usage: node scripts/check-preservation.ts --record RECORD.json --original ORIGINAL.md --draft DRAFT.md"
    );
  }
  const result = check(record, original, draft);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.gate === "passed") {
    console.log("OK: preservation record covers the exact update diff");
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

runMain(main);
