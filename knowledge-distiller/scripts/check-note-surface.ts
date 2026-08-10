#!/usr/bin/env node
// Mechanical Markdown/Obsidian surface gate. It does not judge truth or teaching quality.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { canonicalCalloutType, parseMarkdown } from "./lib/markdown.ts";
import { evidence, exitForGate, finding, printEvidence, type Evidence, type Finding } from "./lib/evidence.ts";

function check(fileInput: string, portable: boolean, strict: boolean): Evidence {
  const file = path.resolve(fileInput);
  const findings: Finding[] = [];
  if (!fs.existsSync(file)) {
    findings.push(finding("file-missing", "error", "note file does not exist", { path: file }));
    return evidence("check-note-surface", "failed", { path: file }, {}, findings);
  }
  if (!fs.statSync(file).isFile()) {
    findings.push(finding("file-not-regular", "error", "note path is not a regular file", { path: file }));
    return evidence("check-note-surface", "failed", { path: file }, {}, findings);
  }
  const surface = parseMarkdown(file);
  for (const item of surface.parse_errors) findings.push(finding(item.code, "error", item.message, { path: file, line: item.line }));

  for (const fence of surface.fences) {
    if (!fence.language) {
      findings.push(finding("code-language-missing", strict ? "error" : "warning", "fenced code block has no language tag", {
        path: file,
        line: fence.line,
      }));
    }
  }

  for (const callout of surface.callouts) {
    if (!canonicalCalloutType(callout.type)) {
      findings.push(finding("callout-custom-type", portable ? "error" : "warning", `callout type ${callout.type} is not portable without vault-specific CSS/plugin support`, {
        path: file,
        line: callout.line,
        evidence: { type: callout.type, depth: callout.depth },
      }));
    }
  }

  for (let i = 0; i < surface.lines.length; i += 1) {
    const line = surface.lines[i];
    if (/^\s*>\s*\[![A-Za-z0-9_-]+\][+-]?/.test(line)) {
      const next = surface.lines[i + 1] ?? "";
      if (next.trim() && !/^\s*>/.test(next)) {
        findings.push(finding("callout-prefix-missing", strict ? "error" : "warning", "content immediately after a callout opener is missing the required > prefix", {
          path: file,
          line: i + 2,
        }));
      }
    }
    if (/\]\(\s*javascript:/i.test(line) || /<\s*(?:script|iframe)\b/i.test(line)) {
      findings.push(finding("unsafe-markup-surface", "error", "note contains a script-like or javascript URL surface", { path: file, line: i + 1 }));
    }
  }

  for (const block of surface.mermaid_blocks) {
    const body = block.body;
    const first = body.split(/\r?\n/).find((line) => line.trim())?.trim().toLowerCase() ?? "";
    if (!/^(flowchart|graph|sequencediagram|statediagram-v2)\b/.test(first)) {
      findings.push(finding("mermaid-type-unsupported", "error", "Mermaid block does not start with a supported diagram type", {
        path: file,
        line: block.line,
        evidence: { first_line: first, supported: ["flowchart", "sequenceDiagram", "stateDiagram-v2"] },
      }));
    }
    const forbidden: Array<[RegExp, string]> = [
      [/\bclick\b/i, "click interactions"],
      [/\bcallback\b/i, "callbacks"],
      [/javascript\s*:/i, "javascript URL"],
      [/^\s*%%\s*\{init\}/im, "init directive"],
      [/^\s*config\b/im, "config directive"],
      [/<\s*script\b/i, "embedded script"],
    ];
    for (const [pattern, label] of forbidden) {
      if (pattern.test(body)) findings.push(finding("mermaid-unsafe-syntax", "error", `Mermaid contains forbidden ${label}`, { path: file, line: block.line }));
    }
    if (/^(?:flowchart|graph)\b/i.test(first) && /(?:\[|\(|\{|\|)\s*end\s*(?:\]|\)|\})/i.test(body)) {
      findings.push(finding("mermaid-unquoted-end", strict ? "error" : "warning", "flowchart uses end as an unquoted label or node value", { path: file, line: block.line }));
    }
  }

  for (const [line, text] of surface.body_lines) {
    const masked = text.replace(/`[^`]*`/g, "");
    for (const [token, syntax] of [["**", "bold"], ["~~", "strike"], ["==", "highlight"]] as const) {
      const count = masked.split(token).length - 1;
      if (count % 2 !== 0) {
        findings.push(finding("emphasis-unbalanced", strict ? "error" : "warning", `${syntax} delimiter appears unbalanced`, { path: file, line }));
      }
    }
  }

  const errors = findings.filter((item) => item.severity === "error");
  return evidence("check-note-surface", errors.length === 0 ? "passed" : "failed", {
    path: file,
    sha256: surface.content_hash,
    portable,
    strict,
  }, {
    bytes: surface.bytes,
    lines: surface.lines.length,
    headings: surface.headings.length,
    fences: surface.fences.length,
    callouts: surface.callouts.length,
    tables: surface.tables.length,
    wikilinks: surface.wikilinks.length,
    external_links: surface.external_links.length,
    footnotes: surface.footnotes.length,
    emphasis: surface.emphasis.length,
    mermaid_blocks: surface.mermaid_blocks.length,
  }, findings);
}

function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-surface-"));
  try {
    const valid = path.join(root, "valid.md");
    fs.writeFileSync(valid, [
      "# Main",
      "**结论** 与 `Fiber`。",
      "> [!warning]- 常见误解",
      "> 这是一条边界。",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "```mermaid",
      "flowchart TB",
      "  A[\"开始\"] --> B[\"结束\"]",
      "```",
      "",
    ].join("\n"), "utf8");
    if (check(valid, true, true).gate !== "passed") throw new Error("valid surface should pass");

    const invalid = path.join(root, "invalid.md");
    fs.writeFileSync(invalid, [
      "# Main",
      "> [!custom] bad",
      "```mermaid",
      "flowchart TB",
      "A[\"x\"] --> B[\"end\"]",
      "click A callback()",
      "```",
    ].join("\n"), "utf8");
    if (check(invalid, true, true).gate !== "failed") throw new Error("invalid surface should fail");
    console.log("note-surface checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const json = args.includes("--json");
  const portable = args.includes("--portable");
  const strict = args.includes("--strict");
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") files.push(path.resolve(args[++i] ?? ""));
    else if (!["--json", "--portable", "--strict", "--help", "-h"].includes(args[i])) throw new Error(`unknown argument: ${args[i]}`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/check-note-surface.ts --file NOTE [--portable] [--strict] [--json]");
    console.log("       node scripts/check-note-surface.ts --self-test");
    return 0;
  }
  if (files.length === 0) throw new Error("usage: node scripts/check-note-surface.ts --file NOTE");
  const results = files.map((file) => check(file, portable, strict));
  const merged: Evidence = evidence(
    "check-note-surface",
    results.every((result) => result.gate === "passed") ? "passed" : "failed",
    { paths: files, portable, strict },
    { files: files.length, passed: results.filter((result) => result.gate === "passed").length },
    results.flatMap((result) => result.findings),
    Object.fromEntries(results.map((result) => [String(result.input.path), result])),
  );
  if (!json) {
    const errors = merged.findings.filter((item) => item.severity === "error");
    if (errors.length > 0) errors.forEach((item) => console.error(`ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`));
    else console.log(`OK: checked ${files.length} note(s); Markdown/Obsidian surface is valid`);
  } else printEvidence(merged, true, "");
  return exitForGate(merged.gate);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
