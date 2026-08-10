#!/usr/bin/env node
// Validates the hash-bound teaching model against the exact note headings.
// It checks the editorial contract's shape, not whether the prose is wise.

import * as fs from "node:fs";
import path from "node:path";

import {
  evidence,
  exitForGate,
  finding,
  isRecord,
  nonEmptyString,
  readJsonInput,
  runMain,
  withTempDir,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";
import { parseMarkdown } from "./lib/markdown.ts";

const SCHEMA = "knowledge-distiller.teaching-model.v1";
const ROLES = new Set([
  "premise",
  "mechanism",
  "example",
  "boundary",
  "decision",
  "transition",
]);
const RELATIONS = new Set([
  "root",
  "prerequisite",
  "causal",
  "parallel",
  "composable",
  "alternative",
  "refinement",
]);
const DIAGRAM_DECISIONS = new Set(["required", "helpful", "not_needed"]);
const DIAGRAM_FORMATS = new Set(["mermaid", "ascii", "none"]);

function required(value: unknown, field: string, findings: Finding[]): void {
  if (!nonEmptyString(value)) {
    findings.push(
      finding("teaching-field-missing", "error", `${field} must be non-empty`)
    );
  }
}

type LoadedModel = {
  failure?: Evidence;
  model?: Record<string, unknown>;
  note: string;
  surface?: ReturnType<typeof parseMarkdown>;
};

function loadModel(
  modelInput: string,
  noteInput: string,
  findings: Finding[]
): LoadedModel {
  let model: unknown;
  try {
    model = readJsonInput(modelInput);
  } catch (error) {
    findings.push(
      finding(
        "teaching-model-json-invalid",
        "error",
        `teaching model is not valid JSON: ${(error as Error).message}`
      )
    );
    return {
      failure: evidence(
        "check-teaching-model",
        "failed",
        { model: modelInput, note: noteInput },
        {},
        findings
      ),
      note: path.resolve(noteInput),
    };
  }
  if (!isRecord(model)) {
    findings.push(
      finding(
        "teaching-model-root-type",
        "error",
        "teaching model root must be an object"
      )
    );
    return {
      failure: evidence(
        "check-teaching-model",
        "failed",
        { model: modelInput, note: noteInput },
        {},
        findings
      ),
      note: path.resolve(noteInput),
    };
  }
  const note = path.resolve(noteInput);
  if (!fs.existsSync(note) || !fs.statSync(note).isFile()) {
    findings.push(
      finding("teaching-note-missing", "error", "note file does not exist", {
        path: note,
      })
    );
    return {
      failure: evidence(
        "check-teaching-model",
        "failed",
        { model: modelInput, note },
        {},
        findings
      ),
      note,
    };
  }
  return { model, note, surface: parseMarkdown(note) };
}

function validateModelHeader(
  model: Record<string, unknown>,
  note: string,
  surface: ReturnType<typeof parseMarkdown>,
  findings: Finding[]
): void {
  if (model.schema_version !== SCHEMA) {
    findings.push(
      finding(
        "teaching-model-version-invalid",
        "error",
        `schema_version must be ${SCHEMA}`
      )
    );
  }
  if (model.note_path !== note) {
    findings.push(
      finding(
        "teaching-note-path-mismatch",
        "error",
        "note_path does not identify the checked note",
        { path: note }
      )
    );
  }
  if (model.draft_hash !== surface.content_hash) {
    findings.push(
      finding(
        "teaching-hash-mismatch",
        "error",
        "draft_hash does not match the exact note bytes",
        {
          evidence: {
            actual: model.draft_hash,
            expected: surface.content_hash,
          },
          path: note,
        }
      )
    );
  }
  for (const field of [
    "central_question",
    "spine",
    "after_state",
    "linear_teach_back",
  ]) {
    required(model[field], field, findings);
  }
}

function validateTransition(
  item: Record<string, unknown>,
  index: number,
  line: number,
  headings: ReturnType<typeof parseMarkdown>["headings"],
  findings: Finding[]
): void {
  const nextHeading = headings[index + 1];
  if (nextHeading) {
    required(item.next_heading, `sections[${index}].next_heading`, findings);
    if (item.next_heading !== nextHeading.text) {
      findings.push(
        finding(
          "teaching-next-heading-mismatch",
          "error",
          `sections[${index}].next_heading must match the next note heading`,
          {
            evidence: { actual: item.next_heading, expected: nextHeading.text },
            line,
          }
        )
      );
    }
    if (item.next_line !== nextHeading.line) {
      findings.push(
        finding(
          "teaching-next-mismatch",
          "error",
          `sections[${index}].next_line must point to the next heading`,
          {
            evidence: { actual: item.next_line, expected: nextHeading.line },
            line,
          }
        )
      );
    }
    return;
  }
  if (item.next_heading !== null) {
    findings.push(
      finding(
        "teaching-terminal-next-heading",
        "error",
        "the final section must set next_heading to null",
        { line }
      )
    );
  }
  if (item.next_line !== null) {
    findings.push(
      finding(
        "teaching-terminal-next",
        "error",
        "the final section must set next_line to null",
        { line }
      )
    );
  }
}

function validateSection(
  item: Record<string, unknown>,
  index: number,
  heading: ReturnType<typeof parseMarkdown>["headings"][number],
  headings: ReturnType<typeof parseMarkdown>["headings"],
  seen: Set<number>,
  findings: Finding[]
): void {
  const line = Number(item.line);
  if (headings[index]?.line !== line) {
    findings.push(
      finding(
        "teaching-section-order",
        "error",
        `sections[${index}] must follow the note heading order`,
        { line }
      )
    );
  }
  if (seen.has(line)) {
    findings.push(
      finding(
        "teaching-section-duplicate",
        "error",
        `heading line ${line} is covered more than once`
      )
    );
  }
  seen.add(line);
  if (item.heading !== heading.text) {
    findings.push(
      finding(
        "teaching-section-heading-mismatch",
        "error",
        `sections[${index}].heading must match the note heading`,
        { line }
      )
    );
  }
  for (const field of [
    "question",
    "answer",
    "dependency",
    "boundary",
    "why_next",
  ]) {
    required(item[field], `sections[${index}].${field}`, findings);
  }
  if (!ROLES.has(String(item.role))) {
    findings.push(
      finding(
        "teaching-role-invalid",
        "error",
        `sections[${index}].role is not canonical`,
        { line }
      )
    );
  }
  if (!RELATIONS.has(String(item.relation))) {
    findings.push(
      finding(
        "teaching-relation-invalid",
        "error",
        `sections[${index}].relation is not canonical`,
        { line }
      )
    );
  }
  validateTransition(item, index, line, headings, findings);
}

function validateSections(
  model: Record<string, unknown>,
  headings: ReturnType<typeof parseMarkdown>["headings"],
  findings: Finding[]
): number {
  const sections = Array.isArray(model.sections) ? model.sections : [];
  if (sections.length !== headings.length) {
    findings.push(
      finding(
        "teaching-section-coverage",
        "error",
        "sections must cover every visible heading exactly once",
        { evidence: { headings: headings.length, sections: sections.length } }
      )
    );
  }
  const headingByLine = new Map(
    headings.map((heading) => [heading.line, heading])
  );
  const seen = new Set<number>();
  for (const [index, item] of sections.entries()) {
    if (!isRecord(item)) {
      findings.push(
        finding(
          "teaching-section-type",
          "error",
          `sections[${index}] must be an object`
        )
      );
      continue;
    }
    const { line: rawLine } = item;
    const line = rawLine;
    if (!Number.isInteger(line) || !headingByLine.has(Number(line))) {
      findings.push(
        finding(
          "teaching-section-heading-invalid",
          "error",
          `sections[${index}].line must identify a visible heading`
        )
      );
      continue;
    }
    validateSection(
      item,
      index,
      headingByLine.get(Number(line)) as ReturnType<
        typeof parseMarkdown
      >["headings"][number],
      headings,
      seen,
      findings
    );
  }
  for (const heading of headings) {
    if (!seen.has(heading.line)) {
      findings.push(
        finding(
          "teaching-heading-uncovered",
          "error",
          `heading line ${heading.line} has no teaching-model section`,
          { line: heading.line }
        )
      );
    }
  }
  return sections.length;
}

function validateDiagram(
  model: Record<string, unknown>,
  surface: ReturnType<typeof parseMarkdown>,
  mermaidRequested: boolean | undefined,
  findings: Finding[]
): void {
  const diagram = isRecord(model.diagram_policy)
    ? model.diagram_policy
    : undefined;
  if (!diagram) {
    findings.push(
      finding(
        "teaching-diagram-policy-missing",
        "error",
        "diagram_policy is required"
      )
    );
    return;
  }
  required(diagram.reader_question, "diagram_policy.reader_question", findings);
  required(diagram.reason, "diagram_policy.reason", findings);
  if (!DIAGRAM_DECISIONS.has(String(diagram.decision))) {
    findings.push(
      finding(
        "teaching-diagram-decision-invalid",
        "error",
        "diagram_policy.decision must be required, helpful, or not_needed"
      )
    );
  }
  if (!DIAGRAM_FORMATS.has(String(diagram.format))) {
    findings.push(
      finding(
        "teaching-diagram-format-invalid",
        "error",
        "diagram_policy.format must be mermaid, ascii, or none"
      )
    );
  }
  if (
    (diagram.decision === "not_needed" && diagram.format !== "none") ||
    (diagram.decision !== "not_needed" && diagram.format === "none")
  ) {
    findings.push(
      finding(
        "teaching-diagram-combination-invalid",
        "error",
        "diagram_policy decision and format must agree"
      )
    );
  }
  if (typeof diagram.user_requested_mermaid !== "boolean") {
    findings.push(
      finding(
        "teaching-mermaid-request-flag-invalid",
        "error",
        "diagram_policy.user_requested_mermaid must be boolean"
      )
    );
  }
  if (
    typeof mermaidRequested === "boolean" &&
    diagram.user_requested_mermaid !== mermaidRequested
  ) {
    findings.push(
      finding(
        "teaching-mermaid-request-context-mismatch",
        "error",
        "diagram_policy.user_requested_mermaid must match the explicit checker request context"
      )
    );
  }
  if (
    mermaidRequested === true &&
    (diagram.decision !== "required" || diagram.format !== "mermaid")
  ) {
    findings.push(
      finding(
        "teaching-mermaid-request-ignored",
        "error",
        "an explicit Mermaid request requires decision=required and format=mermaid"
      )
    );
  }
  if (
    diagram.decision === "required" &&
    diagram.format === "mermaid" &&
    surface.mermaid_blocks.length === 0
  ) {
    findings.push(
      finding(
        "teaching-mermaid-required-missing",
        "error",
        "required Mermaid decision has no Mermaid block in the note"
      )
    );
  }
}

function check(
  modelInput: string,
  noteInput: string,
  mermaidRequested: boolean | undefined
): Evidence {
  const findings: Finding[] = [];
  if (typeof mermaidRequested !== "boolean") {
    findings.push(
      finding(
        "teaching-mermaid-request-context-missing",
        "error",
        "the checker requires an explicit Mermaid request context"
      )
    );
  }
  const loaded = loadModel(modelInput, noteInput, findings);
  if (loaded.failure) {
    return loaded.failure;
  }
  const { model: loadedModel, note, surface: loadedSurface } = loaded;
  const model = loadedModel as Record<string, unknown>;
  const surface = loadedSurface as ReturnType<typeof parseMarkdown>;
  validateModelHeader(model, note, surface, findings);
  const sections = validateSections(model, surface.headings, findings);
  validateDiagram(model, surface, mermaidRequested, findings);
  const errors = findings.filter((item) => item.severity === "error");
  return evidence(
    "check-teaching-model",
    errors.length === 0 ? "passed" : "failed",
    { model: path.resolve(modelInput), note, sha256: surface.content_hash },
    {
      headings: surface.headings.length,
      mermaid_blocks: surface.mermaid_blocks.length,
      sections,
    },
    findings
  );
}

function selfTest(): number {
  return withTempDir("knowledge-distiller-teaching-", (root) => {
    const note = path.join(root, "Note.md");
    fs.writeFileSync(note, "# One\n## Two\n", "utf-8");
    const surface = parseMarkdown(note);
    const model = path.join(root, "model.json");
    fs.writeFileSync(
      model,
      JSON.stringify({
        after_state: "a",
        central_question: "q",
        diagram_policy: {
          decision: "not_needed",
          format: "none",
          reader_question: "none",
          reason: "plain prose is shorter",
          user_requested_mermaid: false,
        },
        draft_hash: surface.content_hash,
        linear_teach_back: "t",
        note_path: note,
        schema_version: SCHEMA,
        sections: [
          {
            answer: "a",
            boundary: "b",
            dependency: "d",
            heading: "One",
            line: 1,
            next_heading: "Two",
            next_line: 2,
            question: "q",
            relation: "root",
            role: "premise",
            why_next: "w",
          },
          {
            answer: "a",
            boundary: "b",
            dependency: "d",
            heading: "Two",
            line: 2,
            next_heading: null,
            next_line: null,
            question: "q",
            relation: "refinement",
            role: "decision",
            why_next: "terminal",
          },
        ],
        spine: "s",
      }),
      "utf-8"
    );
    const valid = check(model, note, false);
    if (valid.gate !== "passed") {
      throw new Error(
        `valid model should pass: ${JSON.stringify(valid.findings)}`
      );
    }
    const validModel = JSON.parse(fs.readFileSync(model, "utf-8"));
    if (check(model, note, true).gate !== "failed") {
      throw new Error(
        "explicit Mermaid request must not be self-reported away"
      );
    }
    const requestedModel = structuredClone(validModel);
    requestedModel.diagram_policy = {
      ...requestedModel.diagram_policy,
      decision: "required",
      format: "mermaid",
      user_requested_mermaid: true,
    };
    fs.writeFileSync(model, JSON.stringify(requestedModel), "utf-8");
    if (check(model, note, true).gate !== "failed") {
      throw new Error("required Mermaid without a block should fail");
    }
    fs.writeFileSync(
      model,
      JSON.stringify({
        ...validModel,
        diagram_policy: {
          ...validModel.diagram_policy,
          decision: "helpful",
          format: "none",
        },
      }),
      "utf-8"
    );
    if (check(model, note, false).gate !== "failed") {
      throw new Error("incoherent diagram policy should fail");
    }
    const missingTerminal = structuredClone(validModel);
    delete missingTerminal.sections[1].next_line;
    fs.writeFileSync(model, JSON.stringify(missingTerminal), "utf-8");
    if (check(model, note, false).gate !== "failed") {
      throw new Error("missing terminal next_line should fail");
    }
    fs.writeFileSync(
      model,
      JSON.stringify({ ...validModel, sections: [] }),
      "utf-8"
    );
    if (check(model, note, false).gate !== "failed") {
      throw new Error("uncovered headings should fail");
    }
    fs.writeFileSync(
      model,
      JSON.stringify({
        ...validModel,
        sections: validModel.sections.toReversed(),
      }),
      "utf-8"
    );
    if (check(model, note, false).gate !== "failed") {
      throw new Error("reordered sections should fail");
    }
    console.log("teaching-model checker self-test: PASS");
    return 0;
  });
}

type TeachingCliArgs = {
  help: boolean;
  json: boolean;
  mermaidRequested?: boolean;
  model: string;
  note: string;
};

function parseArgs(args: string[]): TeachingCliArgs {
  let model = "";
  let note = "";
  let mermaidRequested: boolean | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === "--model") {
      i += 1;
      model = args[i] ?? "";
    } else if (argument === "--note") {
      i += 1;
      note = args[i] ?? "";
    } else if (argument === "--mermaid-requested") {
      mermaidRequested = true;
    } else if (argument === "--mermaid-not-requested") {
      mermaidRequested = false;
    } else if (!["--json", "--help", "-h"].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    mermaidRequested,
    model,
    note,
  };
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    return selfTest();
  }
  const { help, json, mermaidRequested, model, note } = parseArgs(args);
  if (help) {
    console.log(
      "usage: node scripts/check-teaching-model.ts --model MODEL.json --note NOTE --mermaid-requested|--mermaid-not-requested [--json]"
    );
    console.log("       node scripts/check-teaching-model.ts --self-test");
    return 0;
  }
  if (
    args.includes("--mermaid-requested") &&
    args.includes("--mermaid-not-requested")
  ) {
    throw new Error("choose exactly one Mermaid request context flag");
  }
  if (!model || !note || typeof mermaidRequested !== "boolean") {
    throw new Error(
      "usage: node scripts/check-teaching-model.ts --model MODEL.json --note NOTE --mermaid-requested|--mermaid-not-requested"
    );
  }
  const result = check(model, note, mermaidRequested);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.gate === "passed") {
    console.log("OK: teaching model matches exact note headings and hash");
  } else {
    for (const item of result.findings.filter(
      (entry) => entry.severity === "error"
    )) {
      console.error(
        `ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`
      );
    }
  }
  return exitForGate(result.gate);
}

runMain(main);
