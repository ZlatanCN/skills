#!/usr/bin/env node
// Aggregates the note-local mechanical gates. Semantic links, evidence, and reviewer quality remain separate.

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
  runMain,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";
import { parseMarkdown } from "./lib/markdown.ts";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

type ChildRun = { result: Evidence; status: number | null; stderr: string };

function runChecker(script: string, args: string[], input?: string): ChildRun {
  const command = path.join(SCRIPT_DIR, script);
  const child = spawnSync(process.execPath, [command, ...args, "--json"], {
    encoding: "utf-8",
    input,
  });
  const stdout = child.stdout ?? "";
  try {
    const parsed = JSON.parse(stdout) as Evidence;
    if (
      !isRecord(parsed) ||
      !new Set(["passed", "failed", "unavailable"]).has(String(parsed.gate)) ||
      !Array.isArray(parsed.findings)
    ) {
      return {
        result: evidence("check-note", "unavailable", { args, script }, {}, [
          finding(
            "checker-envelope-invalid",
            "error",
            "child checker returned a malformed evidence envelope",
            { evidence: { stderr: child.stderr ?? "", stdout } }
          ),
        ]),
        status: child.status,
        stderr: child.stderr ?? "",
      };
    }
    if (child.status !== exitForGate(parsed.gate)) {
      return {
        result: {
          ...parsed,
          findings: [
            ...parsed.findings,
            finding(
              "checker-exit-mismatch",
              "error",
              "checker exit code contradicts its JSON gate",
              { evidence: { exit_code: child.status, gate: parsed.gate } }
            ),
          ],
          gate: "unavailable",
        },
        status: child.status,
        stderr: child.stderr ?? "",
      };
    }
    return { result: parsed, status: child.status, stderr: child.stderr ?? "" };
  } catch (error) {
    return {
      result: evidence("check-note", "unavailable", { args, script }, {}, [
        finding(
          "checker-output-invalid",
          "error",
          `checker did not return JSON: ${(error as Error).message}`,
          { evidence: { stderr: child.stderr ?? "", stdout } }
        ),
      ]),
      status: child.status,
      stderr: child.stderr ?? "",
    };
  }
}

function validateInputs(
  note: string,
  vaultRoot: string,
  formatPlan: string,
  original: string,
  preservation: string
): Finding[] {
  const findings: Finding[] = [];
  if (!vaultRoot) {
    findings.push(
      finding(
        "vault-root-missing",
        "error",
        "vault-root is required for a deterministic note gate"
      )
    );
  }
  if (!formatPlan) {
    findings.push(
      finding(
        "format-plan-missing",
        "error",
        "format-plan is required for a deterministic note gate"
      )
    );
  }
  if (!fs.existsSync(note) || !fs.statSync(note).isFile()) {
    findings.push(
      finding("note-missing", "error", "note file does not exist", {
        path: note,
      })
    );
  }
  if (Boolean(original) !== Boolean(preservation)) {
    findings.push(
      finding(
        "preservation-pair-incomplete",
        "error",
        "original and preservation must be supplied together"
      )
    );
  }
  return findings;
}

function runChecks(
  note: string,
  vaultRoot: string,
  formatPlan: string,
  strict: boolean,
  portable: boolean,
  original: string,
  preservation: string
): Record<string, Evidence> {
  const surface = runChecker("check-note-surface.ts", [
    "--file",
    note,
    ...(strict ? ["--strict"] : []),
    ...(portable ? ["--portable"] : []),
  ]);
  const heading = runChecker("check-heading-tree.ts", [
    "--file",
    note,
    "--strict",
  ]);
  const links = runChecker("check-wikilinks.ts", [
    "--vault-root",
    path.resolve(vaultRoot),
    "--file",
    note,
  ]);
  const planInput =
    formatPlan === "-" ? fs.readFileSync(0, "utf-8") : undefined;
  const plan = runChecker(
    "check-format-plan.ts",
    [
      "--plan",
      formatPlan === "-" ? "-" : path.resolve(formatPlan),
      "--note",
      note,
    ],
    planInput
  );
  const checks: Record<string, Evidence> = {
    format_plan: plan.result,
    heading: heading.result,
    surface: surface.result,
    wikilinks: links.result,
  };
  if (original && preservation) {
    checks.preservation = runChecker("check-preservation.ts", [
      "--record",
      path.resolve(preservation),
      "--original",
      path.resolve(original),
      "--draft",
      note,
    ]).result;
  }
  return checks;
}

function appendChildFindings(
  checks: Record<string, Evidence>,
  findings: Finding[]
): void {
  for (const result of Object.values(checks)) {
    findings.push(
      ...result.findings.map((item) => ({
        ...item,
        evidence: { ...item.evidence, checker: result.checker },
      }))
    );
  }
}

function resolvePlanInput(formatPlan: string): string | undefined {
  if (formatPlan === "-") {
    return "stdin";
  }
  if (formatPlan) {
    return path.resolve(formatPlan);
  }
  return undefined;
}

function check(
  noteInput: string,
  vaultRoot: string,
  formatPlan: string,
  strict: boolean,
  portable: boolean,
  original = "",
  preservation = ""
): Evidence {
  const note = path.resolve(noteInput);
  const findings = validateInputs(
    note,
    vaultRoot,
    formatPlan,
    original,
    preservation
  );
  const checks: Record<string, Evidence> =
    findings.length === 0
      ? runChecks(
          note,
          vaultRoot,
          formatPlan,
          strict,
          portable,
          original,
          preservation
        )
      : {};
  if (Object.keys(checks).length > 0) {
    appendChildFindings(checks, findings);
  }

  const childUnavailable = Object.values(checks).some(
    (result) => result.gate === "unavailable"
  );
  const childFailed = Object.values(checks).some(
    (result) => result.gate === "failed"
  );
  const configFailed = findings.length > 0 && Object.keys(checks).length === 0;
  let gate: Evidence["gate"] = "passed";
  if (configFailed || childFailed) {
    gate = "failed";
  } else if (childUnavailable) {
    gate = "unavailable";
  }
  const { surface } = checks;
  return evidence(
    "check-note",
    gate,
    {
      format_plan: resolvePlanInput(formatPlan),
      original: original ? path.resolve(original) : undefined,
      path: note,
      portable,
      preservation: preservation ? path.resolve(preservation) : undefined,
      sha256:
        fs.existsSync(note) && fs.statSync(note).isFile()
          ? parseMarkdown(note).content_hash
          : undefined,
      strict,
      vault_root: vaultRoot ? path.resolve(vaultRoot) : undefined,
    },
    {
      hard_gate_count: Object.keys(checks).length,
      hard_gate_passed: Object.values(checks).filter(
        (result) => result.gate === "passed"
      ).length,
      surface_metrics: surface?.metrics ?? {},
    },
    findings,
    checks
  );
}

function selfTest(): number {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-distiller-note-gate-")
  );
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
    fs.writeFileSync(note, body, "utf-8");
    const hash = parseMarkdown(note).content_hash;
    const plan = path.join(root, "plan.json");
    fs.writeFileSync(
      plan,
      JSON.stringify({
        callout_candidates: [
          { decision: "keep", line: 3, reader_function: "隔离边界" },
        ],
        code_table_diagram_map: [
          {
            decision: "keep",
            kind: "code",
            line: 6,
            reader_function: "展示实现",
          },
        ],
        coverage_note: "按行号覆盖全部保留表面。",
        draft_hash: hash,
        emphasis_targets: [
          {
            decision: "keep",
            line: 2,
            raw: "**结论**",
            reader_function: "扫描结论",
          },
        ],
        link_surface: { external_links: [], footnotes: [], wikilinks: [] },
        note_path: note,
        render_risks: [],
        render_status: "not_applicable",
        schema_version: "knowledge-distiller.format-plan.v1",
      }),
      "utf-8"
    );
    const original = path.join(root, "Original.md");
    fs.writeFileSync(original, body.replace("**结论**", "**旧结论**"), "utf-8");
    const preservation = path.join(root, "preservation.json");
    fs.writeFileSync(
      preservation,
      JSON.stringify({
        changed_units: [
          {
            draft_end: 2,
            draft_start: 2,
            operation: "rewrite",
            original_end: 2,
            original_start: 2,
            reason: "corrected conclusion",
          },
        ],
        draft_hash: fileHash(note),
        original_hash: fileHash(original),
        schema_version: "knowledge-distiller.preservation.v1",
        scope: "targeted_update",
      }),
      "utf-8"
    );
    const result = check(note, vault, plan, true, true, original, preservation);
    if (result.gate !== "passed") {
      throw new Error(
        `valid aggregate should pass: ${JSON.stringify(result.findings)}`
      );
    }
    const unavailable = check(
      note,
      path.join(root, "missing-vault"),
      plan,
      true,
      true
    );
    if (unavailable.gate !== "unavailable") {
      throw new Error("an unavailable child gate must remain unavailable");
    }
    console.log("note gate self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

type NoteCliArgs = {
  help: boolean;
  json: boolean;
  note: string;
  original: string;
  plan: string;
  portable: boolean;
  preservation: string;
  strict: boolean;
  vault: string;
};

function parseArgs(args: string[]): NoteCliArgs {
  let note = "";
  let vault = "";
  let plan = "";
  let original = "";
  let preservation = "";
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === "--file") {
      i += 1;
      note = args[i] ?? "";
    } else if (argument === "--vault-root") {
      i += 1;
      vault = args[i] ?? "";
    } else if (argument === "--format-plan") {
      i += 1;
      plan = args[i] ?? "";
    } else if (argument === "--original") {
      i += 1;
      original = args[i] ?? "";
    } else if (argument === "--preservation") {
      i += 1;
      preservation = args[i] ?? "";
    } else if (
      !["--json", "--strict", "--portable", "--help", "-h"].includes(argument)
    ) {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    note,
    original,
    plan,
    portable: args.includes("--portable"),
    preservation,
    strict: args.includes("--strict"),
    vault,
  };
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    return selfTest();
  }
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(
      "usage: node scripts/check-note.ts --file NOTE --vault-root VAULT --format-plan PLAN.json|- [--original ORIGINAL] [--preservation RECORD.json] [--strict] [--portable] [--json]"
    );
    console.log("       node scripts/check-note.ts --self-test");
    return 0;
  }
  const { json, note, original, plan, portable, preservation, strict, vault } =
    parsed;
  if (!note) {
    throw new Error(
      "usage: node scripts/check-note.ts --file NOTE --vault-root VAULT --format-plan PLAN.json|-"
    );
  }
  const result = check(
    note,
    vault,
    plan,
    strict,
    portable,
    original,
    preservation
  );
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.gate === "passed") {
    console.log("OK: note mechanical gates passed");
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
