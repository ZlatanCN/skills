#!/usr/bin/env node
// Aggregates the note-local mechanical gates. Semantic links, evidence, and reviewer quality remain separate.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseMarkdown } from "./lib/markdown.ts";
import { evidence, exitForGate, fileHash, finding, isRecord, type Evidence, type Finding } from "./lib/evidence.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

type ChildRun = { result: Evidence; status: number | null; stderr: string };

function runChecker(script: string, args: string[], input?: string): ChildRun {
  const command = path.join(SCRIPT_DIR, script);
  const child = spawnSync(process.execPath, [command, ...args, "--json"], { encoding: "utf8", input });
  const stdout = child.stdout ?? "";
  try {
    const parsed = JSON.parse(stdout) as Evidence;
    if (!isRecord(parsed) || !new Set(["passed", "failed", "unavailable"]).has(String(parsed.gate)) || !Array.isArray(parsed.findings)) {
      return {
        status: child.status,
        stderr: child.stderr ?? "",
        result: evidence("check-note", "unavailable", { script, args }, {}, [finding("checker-envelope-invalid", "error", "child checker returned a malformed evidence envelope", { evidence: { stdout, stderr: child.stderr ?? "" } })]),
      };
    }
    if (child.status !== exitForGate(parsed.gate)) {
      return {
        status: child.status,
        stderr: child.stderr ?? "",
        result: {
          ...parsed,
          gate: "unavailable",
          findings: [...parsed.findings, finding("checker-exit-mismatch", "error", "checker exit code contradicts its JSON gate", { evidence: { exit_code: child.status, gate: parsed.gate } })],
        },
      };
    }
    return { result: parsed, status: child.status, stderr: child.stderr ?? "" };
  } catch (error) {
    return {
      status: child.status,
      stderr: child.stderr ?? "",
      result: evidence("check-note", "unavailable", { script, args }, {}, [finding("checker-output-invalid", "error", `checker did not return JSON: ${(error as Error).message}`, { evidence: { stdout, stderr: child.stderr ?? "" } })]),
    };
  }
}

function check(noteInput: string, vaultRoot: string, formatPlan: string, strict: boolean, portable: boolean, original = "", preservation = ""): Evidence {
  const note = path.resolve(noteInput);
  const findings: Finding[] = [];
  if (!vaultRoot) findings.push(finding("vault-root-missing", "error", "vault-root is required for a deterministic note gate"));
  if (!formatPlan) findings.push(finding("format-plan-missing", "error", "format-plan is required for a deterministic note gate"));
  if (!fs.existsSync(note) || !fs.statSync(note).isFile()) findings.push(finding("note-missing", "error", "note file does not exist", { path: note }));
  if (Boolean(original) !== Boolean(preservation)) findings.push(finding("preservation-pair-incomplete", "error", "original and preservation must be supplied together"));

  const checks: Record<string, Evidence> = {};
  if (findings.length === 0) {
    const surface = runChecker("check-note-surface.ts", ["--file", note, ...(strict ? ["--strict"] : []), ...(portable ? ["--portable"] : [])]);
    const heading = runChecker("check-heading-tree.ts", ["--file", note, "--strict"]);
    const links = runChecker("check-wikilinks.ts", ["--vault-root", path.resolve(vaultRoot), "--file", note]);
    const planInput = formatPlan === "-" ? fs.readFileSync(0, "utf8") : undefined;
    const plan = runChecker("check-format-plan.ts", ["--plan", formatPlan === "-" ? "-" : path.resolve(formatPlan), "--note", note], planInput);
    const preservationCheck = original && preservation
      ? runChecker("check-preservation.ts", ["--record", path.resolve(preservation), "--original", path.resolve(original), "--draft", note])
      : undefined;
    checks.surface = surface.result;
    checks.heading = heading.result;
    checks.wikilinks = links.result;
    checks.format_plan = plan.result;
    if (preservationCheck) checks.preservation = preservationCheck.result;
    for (const result of Object.values(checks)) findings.push(...result.findings.map((item) => ({ ...item, evidence: { ...(item.evidence ?? {}), checker: result.checker } })));
  }

  const childUnavailable = Object.values(checks).some((result) => result.gate === "unavailable");
  const childFailed = Object.values(checks).some((result) => result.gate === "failed");
  const configFailed = findings.length > 0 && Object.keys(checks).length === 0;
  const gate = configFailed || childFailed ? "failed" : childUnavailable ? "unavailable" : "passed";
  const surface = checks.surface;
  return evidence("check-note", gate, {
    path: note,
    sha256: fs.existsSync(note) && fs.statSync(note).isFile() ? parseMarkdown(note).content_hash : undefined,
    vault_root: vaultRoot ? path.resolve(vaultRoot) : undefined,
    format_plan: formatPlan === "-" ? "stdin" : formatPlan ? path.resolve(formatPlan) : undefined,
    original: original ? path.resolve(original) : undefined,
    preservation: preservation ? path.resolve(preservation) : undefined,
    strict,
    portable,
  }, {
    hard_gate_count: Object.keys(checks).length,
    hard_gate_passed: Object.values(checks).filter((result) => result.gate === "passed").length,
    surface_metrics: surface?.metrics ?? {},
  }, findings, checks);
}

function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-note-gate-"));
  try {
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    const note = path.join(vault, "Note.md");
    const body = [
      "# Main",
      "**结论**",
      "> [!info] 边界",
      "> 仅作示例。",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    fs.writeFileSync(note, body, "utf8");
    const hash = parseMarkdown(note).content_hash;
    const plan = path.join(root, "plan.json");
    fs.writeFileSync(plan, JSON.stringify({
      schema_version: "knowledge-distiller.format-plan.v1",
      note_path: note,
      draft_hash: hash,
      coverage_note: "按行号覆盖全部保留表面。",
      emphasis_targets: [{ line: 2, raw: "**结论**", decision: "keep", reader_function: "扫描结论" }],
      callout_candidates: [{ line: 3, decision: "keep", reader_function: "隔离边界" }],
      code_table_diagram_map: [{ line: 6, kind: "code", decision: "keep", reader_function: "展示实现" }],
      link_surface: { wikilinks: [], external_links: [], footnotes: [] },
      render_status: "not_applicable",
      render_risks: [],
    }), "utf8");
    const original = path.join(root, "Original.md");
    fs.writeFileSync(original, body.replace("**结论**", "**旧结论**"), "utf8");
    const preservation = path.join(root, "preservation.json");
    fs.writeFileSync(preservation, JSON.stringify({
      schema_version: "knowledge-distiller.preservation.v1",
      scope: "targeted_update",
      original_hash: fileHash(original),
      draft_hash: fileHash(note),
      changed_units: [{ original_start: 2, original_end: 2, draft_start: 2, draft_end: 2, operation: "rewrite", reason: "corrected conclusion" }],
    }), "utf8");
    const result = check(note, vault, plan, true, true, original, preservation);
    if (result.gate !== "passed") throw new Error(`valid aggregate should pass: ${JSON.stringify(result.findings)}`);
    const unavailable = check(note, path.join(root, "missing-vault"), plan, true, true);
    if (unavailable.gate !== "unavailable") throw new Error("an unavailable child gate must remain unavailable");
    console.log("note gate self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const portable = args.includes("--portable");
  let note = "";
  let vault = "";
  let plan = "";
  let original = "";
  let preservation = "";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") note = args[++i] ?? "";
    else if (args[i] === "--vault-root") vault = args[++i] ?? "";
    else if (args[i] === "--format-plan") plan = args[++i] ?? "";
    else if (args[i] === "--original") original = args[++i] ?? "";
    else if (args[i] === "--preservation") preservation = args[++i] ?? "";
    else if (!["--json", "--strict", "--portable", "--help", "-h"].includes(args[i])) throw new Error(`unknown argument: ${args[i]}`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/check-note.ts --file NOTE --vault-root VAULT --format-plan PLAN.json|- [--original ORIGINAL] [--preservation RECORD.json] [--strict] [--portable] [--json]");
    console.log("       node scripts/check-note.ts --self-test");
    return 0;
  }
  if (!note) throw new Error("usage: node scripts/check-note.ts --file NOTE --vault-root VAULT --format-plan PLAN.json|-");
  const result = check(note, vault, plan, strict, portable, original, preservation);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.gate === "passed") console.log("OK: note mechanical gates passed");
  else result.findings.filter((item) => item.severity === "error").forEach((item) => console.error(`ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`));
  return exitForGate(result.gate);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
