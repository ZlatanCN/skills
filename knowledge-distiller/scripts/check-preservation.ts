#!/usr/bin/env node
// Verifies byte identity and mechanical coverage of an update diff. It does not judge whether an operation is wise.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileHash, evidence, exitForGate, finding, isRecord, readJsonInput, nonEmptyString, type Evidence, type Finding } from "./lib/evidence.ts";

const OPERATIONS = new Set(["keep", "rewrite", "move", "merge", "split", "delete", "defer", "add"]);

type Hunk = { original_start: number; original_end: number; draft_start: number; draft_end: number };

function lines(file: string): string[] {
  return fs.readFileSync(file, "utf8").split(/\r?\n/);
}

function diffHunks(original: string[], draft: string[]): Hunk[] {
  const rows = Array.from({ length: original.length + 1 }, () => new Uint32Array(draft.length + 1));
  for (let i = original.length - 1; i >= 0; i -= 1) {
    for (let j = draft.length - 1; j >= 0; j -= 1) {
      rows[i][j] = original[i] === draft[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let startI = -1;
  let startJ = -1;
  const close = (): void => {
    if (startI < 0) return;
    hunks.push({
      original_start: startI < i ? startI + 1 : 0,
      original_end: startI < i ? i : 0,
      draft_start: startJ < j ? startJ + 1 : 0,
      draft_end: startJ < j ? j : 0,
    });
    startI = -1;
    startJ = -1;
  };
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
    if (i >= original.length) j += 1;
    else if (j >= draft.length) i += 1;
    else if (rows[i + 1][j] >= rows[i][j + 1]) i += 1;
    else j += 1;
  }
  close();
  return hunks;
}

function rangeCovers(unit: Record<string, unknown>, hunk: Hunk): boolean {
  const oi = Number(unit.original_start ?? 0);
  const oe = Number(unit.original_end ?? 0);
  const di = Number(unit.draft_start ?? 0);
  const de = Number(unit.draft_end ?? 0);
  const originalCovered = hunk.original_start === 0 ? oi === 0 && oe === 0 : oi <= hunk.original_start && oe >= hunk.original_end;
  const draftCovered = hunk.draft_start === 0 ? di === 0 && de === 0 : di <= hunk.draft_start && de >= hunk.draft_end;
  return originalCovered && draftCovered;
}

function check(recordInput: string, originalInput?: string, draftInput?: string): Evidence {
  const findings: Finding[] = [];
  let record: unknown;
  try {
    record = readJsonInput(recordInput);
  } catch (error) {
    findings.push(finding("preservation-json-invalid", "error", `preservation record is not valid JSON: ${(error as Error).message}`));
    return evidence("check-preservation", "failed", { record: recordInput, original: originalInput, draft: draftInput }, {}, findings);
  }
  if (!isRecord(record)) {
    findings.push(finding("preservation-root-type", "error", "preservation record root must be an object"));
    return evidence("check-preservation", "failed", { record: recordInput }, {}, findings);
  }
  if (record.schema_version !== "knowledge-distiller.preservation.v1") findings.push(finding("preservation-version-invalid", "error", "schema_version must be knowledge-distiller.preservation.v1"));
  if (!new Set(["targeted_update", "full_recompose"]).has(String(record.scope))) findings.push(finding("preservation-scope-invalid", "error", "scope must be targeted_update or full_recompose"));
  if (!nonEmptyString(record.original_hash) || !nonEmptyString(record.draft_hash)) findings.push(finding("preservation-hash-missing", "error", "original_hash and draft_hash are required"));
  if (!originalInput || !draftInput) findings.push(finding("preservation-path-missing", "error", "original and draft paths are required"));

  let hunks: Hunk[] = [];
  if (originalInput && draftInput) {
    const original = path.resolve(originalInput);
    const draft = path.resolve(draftInput);
    if (!fs.existsSync(original) || !fs.statSync(original).isFile()) findings.push(finding("preservation-original-missing", "error", "original file does not exist", { path: original }));
    if (!fs.existsSync(draft) || !fs.statSync(draft).isFile()) findings.push(finding("preservation-draft-missing", "error", "draft file does not exist", { path: draft }));
    if (fs.existsSync(original) && fs.existsSync(draft)) {
      const originalHash = fileHash(original);
      const draftHash = fileHash(draft);
      if (record.original_hash !== originalHash) findings.push(finding("preservation-original-hash-mismatch", "error", "original_hash does not match original bytes", { path: original, evidence: { expected: originalHash, actual: record.original_hash } }));
      if (record.draft_hash !== draftHash) findings.push(finding("preservation-draft-hash-mismatch", "error", "draft_hash does not match draft bytes", { path: draft, evidence: { expected: draftHash, actual: record.draft_hash } }));
      hunks = diffHunks(lines(original), lines(draft));
    }
  }

  if (!Array.isArray(record.changed_units)) findings.push(finding("preservation-units-type", "error", "changed_units must be an array"));
  const units = Array.isArray(record.changed_units) ? record.changed_units : [];
  units.forEach((unit, index) => {
    if (!isRecord(unit)) {
      findings.push(finding("preservation-unit-type", "error", `changed_units[${index}] must be an object`));
      return;
    }
    if (!OPERATIONS.has(String(unit.operation))) findings.push(finding("preservation-operation-invalid", "error", `changed_units[${index}].operation is not canonical`));
    if (!nonEmptyString(unit.reason)) findings.push(finding("preservation-reason-missing", "error", `changed_units[${index}].reason is required`));
    for (const field of ["original_start", "original_end", "draft_start", "draft_end"]) {
      if (!Number.isInteger(unit[field]) || Number(unit[field]) < 0) findings.push(finding("preservation-range-invalid", "error", `changed_units[${index}].${field} must be a non-negative integer`));
    }
  });
  for (const hunk of hunks) {
    if (!units.some((unit) => isRecord(unit) && rangeCovers(unit, hunk))) findings.push(finding("preservation-hunk-uncovered", "error", "an actual changed line hunk is missing from changed_units", { evidence: hunk }));
  }
  if (hunks.length === 0 && units.length > 0) findings.push(finding("preservation-spurious-unit", "error", "changed_units claims changes but original and draft have no line diff"));

  const errors = findings.filter((item) => item.severity === "error");
  return evidence("check-preservation", errors.length === 0 ? "passed" : "failed", {
    record: recordInput,
    original: originalInput ? path.resolve(originalInput) : undefined,
    draft: draftInput ? path.resolve(draftInput) : undefined,
  }, {
    actual_change_hunks: hunks.length,
    recorded_changed_units: units.length,
    original_hash: record.original_hash,
    draft_hash: record.draft_hash,
  }, findings);
}

function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-preservation-"));
  try {
    const original = path.join(root, "original.md");
    const draft = path.join(root, "draft.md");
    fs.writeFileSync(original, "# Main\nold\nkeep\n", "utf8");
    fs.writeFileSync(draft, "# Main\nnew\nkeep\n", "utf8");
    const record = path.join(root, "record.json");
    fs.writeFileSync(record, JSON.stringify({
      schema_version: "knowledge-distiller.preservation.v1",
      scope: "targeted_update",
      original_hash: fileHash(original),
      draft_hash: fileHash(draft),
      changed_units: [{ original_start: 2, original_end: 2, draft_start: 2, draft_end: 2, operation: "rewrite", reason: "corrected wording" }],
    }), "utf8");
    if (check(record, original, draft).gate !== "passed") throw new Error("valid preservation record should pass");
    fs.writeFileSync(record, JSON.stringify({ ...JSON.parse(fs.readFileSync(record, "utf8")), changed_units: [] }), "utf8");
    if (check(record, original, draft).gate !== "failed") throw new Error("uncovered diff should fail");
    console.log("preservation checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const json = args.includes("--json");
  let record = "";
  let original = "";
  let draft = "";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--record") record = args[++i] ?? "";
    else if (args[i] === "--original") original = args[++i] ?? "";
    else if (args[i] === "--draft") draft = args[++i] ?? "";
    else if (!["--json", "--help", "-h"].includes(args[i])) throw new Error(`unknown argument: ${args[i]}`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/check-preservation.ts --record RECORD.json --original ORIGINAL.md --draft DRAFT.md [--json]");
    console.log("       node scripts/check-preservation.ts --self-test");
    return 0;
  }
  if (!record || !original || !draft) throw new Error("usage: node scripts/check-preservation.ts --record RECORD.json --original ORIGINAL.md --draft DRAFT.md");
  const result = check(record, original, draft);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.gate === "passed") console.log("OK: preservation record covers the exact update diff");
  else result.findings.filter((item) => item.severity === "error").forEach((item) => console.error(`ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`));
  return exitForGate(result.gate);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}

