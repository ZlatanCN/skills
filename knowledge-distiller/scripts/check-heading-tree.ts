#!/usr/bin/env node
// Node 24+ runs this TypeScript directly with its built-in type stripping.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { frontmatterTitle, parseMarkdown, type Heading } from "./lib/markdown.ts";
import { evidence, exitForGate, finding, type Evidence, type Finding } from "./lib/evidence.ts";

function check(fileInput: string, strict: boolean): Evidence {
  const file = path.resolve(fileInput);
  const findings: Finding[] = [];
  if (!fs.existsSync(file)) {
    findings.push(finding("file-missing", "error", "note file does not exist", { path: file }));
    return evidence("check-heading-tree", "failed", { path: file }, {}, findings);
  }
  if (!fs.statSync(file).isFile()) {
    findings.push(finding("file-not-regular", "error", "note path is not a regular file", { path: file }));
    return evidence("check-heading-tree", "failed", { path: file }, {}, findings);
  }

  const surface = parseMarkdown(file);
  for (const parseError of surface.parse_errors) {
    findings.push(finding(parseError.code, "error", parseError.message, { path: file, line: parseError.line }));
  }
  const headings = surface.headings;
  if (headings.length === 0) {
    findings.push(finding("heading-missing", "error", "no Markdown headings found", { path: file }));
  } else if (headings[0].level !== 1) {
    findings.push(finding("heading-root-level", "error", "first heading must be level 1", { path: file, line: headings[0].line }));
  }
  for (let i = 1; i < headings.length; i += 1) {
    const previous = headings[i - 1];
    const current = headings[i];
    if (current.level > previous.level + 1) {
      findings.push(finding("heading-level-jump", "error", `heading jumps from H${previous.level} to H${current.level}`, {
        path: file,
        line: current.line,
        evidence: { previous_line: previous.line, previous_level: previous.level, current_level: current.level },
      }));
    }
  }

  const rootCount = headings.filter((heading) => heading.level === 1).length;
  const title = frontmatterTitle(surface) ?? path.basename(file, ".md");
  if (strict && rootCount === 1 && headings.length > 1 && headings[0].text !== title) {
    findings.push(finding(
      "implicit-title-violation",
      "error",
      "one substantive H1 contains all other headings; use sibling H1 chapters under the implicit-title convention or make the first H1 match the note title",
      { path: file, line: headings[0].line, evidence: { note_title: title, first_heading: headings[0].text } },
    ));
  }

  const duplicateHeadings = new Map<string, Heading[]>();
  for (const heading of headings) duplicateHeadings.set(heading.key, [...(duplicateHeadings.get(heading.key) ?? []), heading]);
  for (const [headingKey, matches] of duplicateHeadings) {
    if (matches.length > 1) {
      findings.push(finding("heading-duplicate", "warning", `heading text is duplicated ${matches.length} times; anchored links may be ambiguous`, {
        path: file,
        line: matches[1].line,
        evidence: { heading: headingKey, lines: matches.map((match) => match.line) },
      }));
    }
  }

  const errors = findings.filter((item) => item.severity === "error");
  return evidence("check-heading-tree", errors.length === 0 ? "passed" : "failed", {
    path: file,
    sha256: surface.content_hash,
    strict,
  }, {
    heading_count: headings.length,
    root_count: rootCount,
  }, findings);
}
function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-heading-"));
  try {
    const cases: Array<[string, boolean]> = [
      ["---\ntitle: Good\n---\n# Good\n## Chapter\n### Detail\n", true],
      ["---\ntitle: Good\n---\n# Chapter A\n## Detail\n# Chapter B\n## Detail\n", true],
      ["---\ntitle: Bad\n---\n# Chapter A\n## Chapter B\n## Chapter C\n", false],
      ["# Good\n### skipped\n", false],
      ["```\n# Fake\n```\n# Real\n", true],
    ];
    for (const [body, expectedPass] of cases) {
      const file = path.join(root, "Good.md");
      fs.writeFileSync(file, body, "utf8");
      const result = check(file, true);
      if ((result.gate === "passed") !== expectedPass) throw new Error(`self-test case failed: ${JSON.stringify(body)}`);
    }
    console.log("heading-tree checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const strict = args.includes("--strict");
  const json = args.includes("--json");
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") files.push(path.resolve(args[++i] ?? ""));
    else if (!["--strict", "--json", "--help", "-h"].includes(args[i])) throw new Error(`unknown argument: ${args[i]}`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/check-heading-tree.ts --strict --file NOTE [--file NOTE ...] [--json]");
    console.log("       node scripts/check-heading-tree.ts --self-test");
    return 0;
  }
  if (files.length === 0) throw new Error("usage: node scripts/check-heading-tree.ts --strict --file NOTE");
  const results = files.map((file) => check(file, strict));
  const merged: Evidence = evidence(
    "check-heading-tree",
    results.every((result) => result.gate === "passed") ? "passed" : "failed",
    { paths: files },
    { files: files.length, passed: results.filter((result) => result.gate === "passed").length },
    results.flatMap((result) => result.findings),
    Object.fromEntries(results.map((result) => [String(result.input.path), result])),
  );
  const humanErrors = merged.findings.filter((item) => item.severity === "error");
  if (!json) {
    if (humanErrors.length > 0) humanErrors.forEach((item) => console.error(`ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`));
    else console.log(`OK: checked ${files.length} note(s); heading tree is structurally valid`);
  } else console.log(JSON.stringify(merged, null, 2));
  return exitForGate(merged.gate);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
