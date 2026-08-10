#!/usr/bin/env node
// Validates the machine-readable part of the writing decision. It cannot judge whether a choice is pedagogically wise.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseMarkdown } from "./lib/markdown.ts";
import { evidence, exitForGate, finding, isRecord, nonEmptyString, readJsonInput, stringValue, type Evidence, type Finding } from "./lib/evidence.ts";

type PlanItem = Record<string, unknown> & { line?: number; raw?: string; decision?: string; reader_function?: string; removal_test?: string };

const PLAN_VERSION = "knowledge-distiller.format-plan.v1";
const DECISIONS = new Set(["keep", "plain", "remove"]);

function items(value: unknown, name: string, findings: Finding[]): PlanItem[] {
  if (!Array.isArray(value)) {
    findings.push(finding("plan-field-type", "error", `${name} must be an array`));
    return [];
  }
  const result: PlanItem[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      findings.push(finding("plan-item-type", "error", `${name}[${index}] must be an object`));
      return;
    }
    result.push(item as PlanItem);
    if (typeof item.line !== "number" || !Number.isInteger(item.line) || item.line < 1) findings.push(finding("plan-line-invalid", "error", `${name}[${index}].line must be a positive integer`));
    if (!DECISIONS.has(String(item.decision))) findings.push(finding("plan-decision-invalid", "error", `${name}[${index}].decision must be keep, plain, or remove`));
    if (!nonEmptyString(item.reader_function)) findings.push(finding("plan-reader-function-missing", "error", `${name}[${index}] must state its reader function`));
    if (item.decision !== "keep" && !nonEmptyString(item.removal_test)) findings.push(finding("plan-removal-test-missing", "error", `${name}[${index}] needs a removal_test when it is not retained as-is`));
  });
  return result;
}

function cover(occurrences: Array<{ line: number; raw?: string }>, entries: PlanItem[], kind: string, findings: Finding[], requiredKind?: string): void {
  const usable = entries.filter((entry) => !requiredKind || entry.kind === requiredKind);
  for (const occurrence of occurrences) {
    const matches = usable.filter((entry) => entry.line === occurrence.line && (!occurrence.raw || !entry.raw || entry.raw === occurrence.raw));
    if (matches.length === 0) {
      findings.push(finding("plan-surface-uncovered", "error", `${kind} at line ${occurrence.line} is not covered by a format-plan item`, { line: occurrence.line, evidence: { kind, raw: occurrence.raw } }));
      continue;
    }
    if (!matches.some((entry) => entry.decision === "keep")) {
      findings.push(finding("plan-surface-not-retained", "error", `${kind} at line ${occurrence.line} is present in the draft but every matching decision is plain/remove`, { line: occurrence.line, evidence: { kind, raw: occurrence.raw, decisions: matches.map((entry) => entry.decision) } }));
    }
  }
}

function check(planInput: string, noteInput?: string): Evidence {
  const findings: Finding[] = [];
  let plan: unknown;
  try {
    plan = readJsonInput(planInput);
  } catch (error) {
    findings.push(finding("plan-json-invalid", "error", `format plan is not valid JSON: ${(error as Error).message}`));
    return evidence("check-format-plan", "failed", { plan: planInput, note: noteInput }, {}, findings);
  }
  if (!isRecord(plan)) {
    findings.push(finding("plan-root-type", "error", "format plan root must be an object"));
    return evidence("check-format-plan", "failed", { plan: planInput, note: noteInput }, {}, findings);
  }
  if (plan.schema_version !== PLAN_VERSION) findings.push(finding("plan-version-invalid", "error", `schema_version must be ${PLAN_VERSION}`));
  if (!nonEmptyString(plan.note_path)) findings.push(finding("plan-note-path-missing", "error", "note_path is required"));
  else if (!path.isAbsolute(String(plan.note_path))) findings.push(finding("plan-note-path-relative", "error", "note_path must be absolute so the plan identity is unambiguous"));
  if (!nonEmptyString(plan.draft_hash)) findings.push(finding("plan-draft-hash-missing", "error", "draft_hash is required"));
  if (!nonEmptyString(plan.coverage_note)) findings.push(finding("plan-coverage-note-missing", "error", "coverage_note is required even when a surface category is empty"));

  let surface;
  if (noteInput) {
    const note = path.resolve(noteInput);
    if (!fs.existsSync(note) || !fs.statSync(note).isFile()) findings.push(finding("note-missing", "error", "note file does not exist", { path: note }));
    else {
      surface = parseMarkdown(note);
      if (stringValue(plan.draft_hash) !== surface.content_hash) findings.push(finding("plan-hash-mismatch", "error", "draft_hash does not match the exact note bytes", { path: note, evidence: { expected: surface.content_hash, actual: plan.draft_hash } }));
      if (stringValue(plan.note_path) && path.resolve(stringValue(plan.note_path) as string) !== note) findings.push(finding("plan-path-mismatch", "error", "note_path does not identify the checked note", { path: note }));
      for (const parseError of surface.parse_errors) findings.push(finding(parseError.code, "error", parseError.message, { path: note, line: parseError.line }));
    }
  }

  const emphasis = items(plan.emphasis_targets, "emphasis_targets", findings);
  const blocks = items(plan.callout_candidates, "callout_candidates", findings);
  const maps = items(plan.code_table_diagram_map, "code_table_diagram_map", findings);
  if (!isRecord(plan.link_surface)) findings.push(finding("plan-link-surface-type", "error", "link_surface must be an object"));
  const links = isRecord(plan.link_surface) ? plan.link_surface : {};
  const wikilinks = items(links.wikilinks, "link_surface.wikilinks", findings);
  const external = items(links.external_links, "link_surface.external_links", findings);
  const footnotes = items(links.footnotes, "link_surface.footnotes", findings);

  const renderStatus = stringValue(plan.render_status);
  if (!new Set(["verified", "unavailable", "not_applicable"]).has(renderStatus ?? "")) findings.push(finding("plan-render-status-invalid", "error", "render_status must be verified, unavailable, or not_applicable"));
  const risks = Array.isArray(plan.render_risks) ? plan.render_risks : [];
  if (!Array.isArray(plan.render_risks)) findings.push(finding("plan-render-risks-type", "error", "render_risks must be an array"));

  if (surface) {
    cover(surface.emphasis.map((item) => ({ line: item.line, raw: item.raw })), emphasis, "emphasis", findings);
    cover(surface.callouts.map((item) => ({ line: item.line })), blocks, "callout", findings);
    cover(surface.fences.filter((fence) => fence.language !== "mermaid").map((item) => ({ line: item.line })), maps, "code block", findings, "code");
    cover(surface.tables.map((item) => ({ line: item.line })), maps, "table", findings, "table");
    cover(surface.mermaid_blocks.map((item) => ({ line: item.line })), maps, "Mermaid diagram", findings, "diagram");
    cover(surface.wikilinks, wikilinks, "wikilink", findings);
    cover(surface.external_links, external, "external link", findings);
    cover(surface.footnotes, footnotes, "footnote", findings);
    if (surface.mermaid_blocks.length > 0 && renderStatus !== "verified" && !risks.some((risk) => String(risk).includes("Mermaid 渲染未验证"))) {
      findings.push(finding("mermaid-render-state-missing", "error", "unverified Mermaid rendering must be reported explicitly in render_risks"));
    }
    if (surface.mermaid_blocks.length === 0 && renderStatus === "verified") findings.push(finding("render-status-inapplicable", "error", "render_status=verified but the note contains no Mermaid block"));
  }

  const errors = findings.filter((item) => item.severity === "error");
  return evidence("check-format-plan", errors.length === 0 ? "passed" : "failed", {
    plan: planInput,
    note: noteInput ? path.resolve(noteInput) : undefined,
    draft_hash: plan.draft_hash,
  }, {
    emphasis: emphasis.length,
    callouts: blocks.length,
    code_table_diagram_items: maps.length,
    wikilinks: wikilinks.length,
    external_links: external.length,
    footnotes: footnotes.length,
    render_status: renderStatus,
  }, findings);
}

function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-format-plan-"));
  try {
    const note = path.join(root, "Note.md");
    fs.writeFileSync(note, [
      "# Main",
      "**结论**",
      "> [!info] 边界",
      "> 仅作示例。",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
    ].join("\n"), "utf8");
    const hash = parseMarkdown(note).content_hash;
    const plan = {
      schema_version: PLAN_VERSION,
      note_path: note,
      draft_hash: hash,
      coverage_note: "所有保留的视觉表面均按行号覆盖。",
      emphasis_targets: [{ line: 2, raw: "**结论**", decision: "keep", reader_function: "扫描段落结论" }],
      callout_candidates: [{ line: 3, decision: "keep", reader_function: "隔离边界" }],
      code_table_diagram_map: [
        { line: 6, kind: "code", decision: "keep", reader_function: "展示可执行语法" },
        { line: 10, kind: "table", decision: "keep", reader_function: "比较同一字段轴" },
      ],
      link_surface: { wikilinks: [], external_links: [], footnotes: [] },
      render_status: "not_applicable",
      render_risks: [],
    };
    const planFile = path.join(root, "plan.json");
    fs.writeFileSync(planFile, JSON.stringify(plan), "utf8");
    if (check(planFile, note).gate !== "passed") throw new Error("valid format plan should pass");
    fs.writeFileSync(planFile, JSON.stringify({ ...plan, emphasis_targets: [{ line: 2, raw: "**结论**", decision: "keep", reader_function: "扫描段落结论" }, { line: 99, decision: "remove", reader_function: "避免装饰性强调", removal_test: "删除后不损失扫描路径" }] }), "utf8");
    if (check(planFile, note).gate !== "passed") throw new Error("an absent remove candidate should not fail current-surface coverage");
    fs.writeFileSync(planFile, JSON.stringify({ ...plan, emphasis_targets: [{ line: 2, raw: "**结论**", decision: "plain", reader_function: "扫描段落结论", removal_test: "改为正文后仍保留结论" }] }), "utf8");
    if (check(planFile, note).gate !== "failed") throw new Error("a present plain decision must not masquerade as retained syntax");
    fs.writeFileSync(planFile, JSON.stringify({ ...plan, emphasis_targets: [] }), "utf8");
    if (check(planFile, note).gate !== "failed") throw new Error("uncovered format surface should fail");
    console.log("format-plan checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const json = args.includes("--json");
  let plan = "";
  let note = "";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--plan") plan = args[++i] ?? "";
    else if (args[i] === "--note") note = args[++i] ?? "";
    else if (!["--json", "--help", "-h"].includes(args[i])) throw new Error(`unknown argument: ${args[i]}`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/check-format-plan.ts --plan PLAN.json|-- --note NOTE [--json]");
    console.log("       node scripts/check-format-plan.ts --self-test");
    return 0;
  }
  if (!plan) throw new Error("usage: node scripts/check-format-plan.ts --plan PLAN.json|-- --note NOTE");
  const result = check(plan, note || undefined);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.gate === "passed") console.log("OK: format plan covers the exact Markdown/Obsidian surface");
  else result.findings.filter((item) => item.severity === "error").forEach((item) => console.error(`ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`));
  return exitForGate(result.gate);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
