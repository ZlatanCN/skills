#!/usr/bin/env node
// Mechanical Markdown/Obsidian surface gate. It does not judge truth or teaching quality.

import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import {
  evidence,
  exitForGate,
  finding,
  printEvidence,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";
import { canonicalCalloutType, parseMarkdown } from "./lib/markdown.ts";

const SUPPORTED_MERMAID_TYPES = [
  "flowchart",
  "graph",
  "swimlane-beta",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "mindmap",
  "timeline",
  "gantt",
  "journey",
  "quadrantChart",
  "pie",
  "xychart",
  "xychart-beta",
  "sankey",
  "sankey-beta",
  "requirementDiagram",
  "gitGraph",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
  "architecture-beta",
  "block",
  "block-beta",
  "packet",
  "packet-beta",
  "kanban",
  "radar-beta",
  "treemap-beta",
  "venn-beta",
  "eventmodeling",
  "ishikawa-beta",
  "wardley-beta",
  "cynefin-beta",
  "treeView-beta",
  "zenuml",
] as const;
const SUPPORTED_MERMAID_TYPE_SET = new Set<string>(SUPPORTED_MERMAID_TYPES);

function collectFenceFindings(
  file: string,
  strict: boolean,
  fences: ReturnType<typeof parseMarkdown>["fences"],
  findings: Finding[]
): void {
  for (const fence of fences) {
    if (!fence.language) {
      findings.push(
        finding(
          "code-language-missing",
          strict ? "error" : "warning",
          "fenced code block has no language tag",
          { line: fence.line, path: file }
        )
      );
    }
  }
}

function collectCalloutFindings(
  file: string,
  portable: boolean,
  callouts: ReturnType<typeof parseMarkdown>["callouts"],
  findings: Finding[]
): void {
  for (const callout of callouts) {
    if (!canonicalCalloutType(callout.type)) {
      findings.push(
        finding(
          "callout-custom-type",
          portable ? "error" : "warning",
          `callout type ${callout.type} is not portable without vault-specific CSS/plugin support`,
          {
            evidence: { depth: callout.depth, type: callout.type },
            line: callout.line,
            path: file,
          }
        )
      );
    }
  }
}

function collectBodyFindings(
  file: string,
  strict: boolean,
  surface: ReturnType<typeof parseMarkdown>,
  findings: Finding[]
): void {
  const bodyLineMap = new Map(surface.body_lines);
  for (const [lineNumber, line] of surface.body_lines) {
    if (/^\s*(?:>\s*)+\[![A-Za-z0-9_-]+\][+-]?/u.test(line)) {
      const next = bodyLineMap.get(lineNumber + 1) ?? "";
      if (next.trim() && !/^\s*>/u.test(next)) {
        findings.push(
          finding(
            "callout-prefix-missing",
            strict ? "error" : "warning",
            "content immediately after a callout opener is missing the required > prefix",
            { line: lineNumber + 1, path: file }
          )
        );
      }
    }
    if (
      /\]\(\s*javascript:/iu.test(line) ||
      /<\s*(?:script|iframe)\b/iu.test(line)
    ) {
      findings.push(
        finding(
          "unsafe-markup-surface",
          "error",
          "note contains a script-like or javascript URL surface",
          { line: lineNumber, path: file }
        )
      );
    }
  }
}

function collectMermaidFindings(
  file: string,
  strict: boolean,
  blocks: ReturnType<typeof parseMarkdown>["mermaid_blocks"],
  findings: Finding[]
): void {
  for (const block of blocks) {
    const { body } = block;
    const first =
      body
        .split(/\r?\n/u)
        .find((line) => line.trim())
        ?.trim() ?? "";
    const firstToken = first.split(/\s+/u)[0] ?? "";
    if (!SUPPORTED_MERMAID_TYPE_SET.has(firstToken)) {
      findings.push(
        finding(
          "mermaid-type-unsupported",
          "error",
          "Mermaid block does not start with a supported diagram type",
          {
            evidence: {
              first_line: first,
              supported: [...SUPPORTED_MERMAID_TYPES],
            },
            line: block.line,
            path: file,
          }
        )
      );
    }
    const forbidden: [RegExp, string][] = [
      [/^\s*click\b/imu, "click interactions"],
      [/\bcallback\s*\(/iu, "callbacks"],
      [/javascript\s*:/iu, "javascript URL"],
      [/^\s*%%\s*\{init\}/imu, "init directive"],
      [/^\s*config\b/imu, "config directive"],
      [/<\s*script\b/iu, "embedded script"],
    ];
    for (const [pattern, label] of forbidden) {
      if (pattern.test(body)) {
        findings.push(
          finding(
            "mermaid-unsafe-syntax",
            "error",
            `Mermaid contains forbidden ${label}`,
            { line: block.line, path: file }
          )
        );
      }
    }
    if (
      (firstToken === "flowchart" || firstToken === "graph") &&
      (/(?:\[|\(|\{|\|)\s*end\s*(?:\]|\)|\})/iu.test(body) ||
        /(?:^|(?:-->|---|-.->|==>)\s*(?:\|[^|\r\n]*\|\s*)?)end(?:\s|$|:)/imu.test(
          body
        ) ||
        /(?:^|\s)end\s+(?:-->|---|-.->|==>)/imu.test(body))
    ) {
      findings.push(
        finding(
          "mermaid-unquoted-end",
          strict ? "error" : "warning",
          "flowchart uses end as an unquoted label or node value",
          { line: block.line, path: file }
        )
      );
    }
  }
}

function collectEmphasisFindings(
  file: string,
  strict: boolean,
  bodyLines: ReturnType<typeof parseMarkdown>["body_lines"],
  findings: Finding[]
): void {
  for (const [line, text] of bodyLines) {
    const masked = text.replaceAll(/`[^`]*`/gu, "");
    for (const [token, syntax] of [
      ["**", "bold"],
      ["~~", "strike"],
      ["==", "highlight"],
    ] as const) {
      const count = masked.split(token).length - 1;
      if (count % 2 !== 0) {
        findings.push(
          finding(
            "emphasis-unbalanced",
            strict ? "error" : "warning",
            `${syntax} delimiter appears unbalanced`,
            { line, path: file }
          )
        );
      }
    }
  }
}

function check(
  fileInput: string,
  portable: boolean,
  strict: boolean
): Evidence {
  const file = path.resolve(fileInput);
  const findings: Finding[] = [];
  if (!fs.existsSync(file)) {
    findings.push(
      finding("file-missing", "error", "note file does not exist", {
        path: file,
      })
    );
    return evidence(
      "check-note-surface",
      "failed",
      { path: file },
      {},
      findings
    );
  }
  if (!fs.statSync(file).isFile()) {
    findings.push(
      finding("file-not-regular", "error", "note path is not a regular file", {
        path: file,
      })
    );
    return evidence(
      "check-note-surface",
      "failed",
      { path: file },
      {},
      findings
    );
  }
  const surface = parseMarkdown(file);
  for (const item of surface.parse_errors) {
    findings.push(
      finding(item.code, "error", item.message, { line: item.line, path: file })
    );
  }

  collectFenceFindings(file, strict, surface.fences, findings);
  collectCalloutFindings(file, portable, surface.callouts, findings);
  collectBodyFindings(file, strict, surface, findings);
  collectMermaidFindings(file, strict, surface.mermaid_blocks, findings);
  collectEmphasisFindings(file, strict, surface.body_lines, findings);

  const errors = findings.filter((item) => item.severity === "error");
  return evidence(
    "check-note-surface",
    errors.length === 0 ? "passed" : "failed",
    {
      path: file,
      portable,
      sha256: surface.content_hash,
      strict,
    },
    {
      bytes: surface.bytes,
      callouts: surface.callouts.length,
      emphasis: surface.emphasis.length,
      external_links: surface.external_links.length,
      fences: surface.fences.length,
      footnotes: surface.footnotes.length,
      headings: surface.headings.length,
      lines: surface.lines.length,
      mermaid_blocks: surface.mermaid_blocks.length,
      tables: surface.tables.length,
      wikilinks: surface.wikilinks.length,
    },
    findings
  );
}

function assertSurfaceFailed(
  root: string,
  name: string,
  lines: string[]
): void {
  const file = path.join(root, `${name}.md`);
  fs.writeFileSync(file, lines.join("\n"), "utf-8");
  if (check(file, true, true).gate !== "failed") {
    throw new Error(`${name} surface should fail`);
  }
}

function selfTest(): number {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-distiller-surface-")
  );
  try {
    const valid = path.join(root, "valid.md");
    fs.writeFileSync(
      valid,
      [
        "# Main",
        "**结论** 与 `Fiber`。",
        "> [!warning]- 常见误解",
        "> 这是一条边界。",
        "> [!question] 嵌套问题",
        "> > [!info] 嵌套边界",
        "> > 只覆盖 renderer。",
        "",
        "| A | B |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "```html",
        "<script>const example = true;</script>",
        "```",
        "",
        "```mermaid",
        "flowchart TB",
        '  A["开始"] --> B["结束"]',
        '  B --> C["click to retry"]',
        '  C --> D["callback handler"]',
        "```",
        "",
        "```mermaid",
        "timeline",
        "  2026 : 扩展 Mermaid 类型",
        "```",
        "",
        "```mermaid",
        "xychart",
        '  title "趋势"',
        "  line [1, 2, 3]",
        "```",
        "",
        ...SUPPORTED_MERMAID_TYPES.filter(
          (type) => !["flowchart", "timeline", "xychart-beta"].includes(type)
        ).map((type) => ["```mermaid", type, "```"].join("\n")),
      ].join("\n"),
      "utf-8"
    );
    const validResult = check(valid, true, true);
    if (validResult.gate !== "passed" || validResult.metrics.callouts !== 3) {
      throw new Error("valid surface should pass, including nested callouts");
    }

    assertSurfaceFailed(root, "unsupported", [
      "```mermaid",
      "unsupportedDiagram",
      "```",
    ]);
    assertSurfaceFailed(root, "unsafe", [
      "```mermaid",
      "flowchart TB",
      "A --> end",
      "A -->|done| end",
      "click A callback()",
      "```",
    ]);
    assertSurfaceFailed(root, "case-sensitive", [
      "```mermaid",
      "c4context",
      "```",
    ]);
    console.log("note-surface checker self-test: PASS");
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
  const portable = args.includes("--portable");
  const strict = args.includes("--strict");
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") {
      i += 1;
      files.push(path.resolve(args[i] ?? ""));
    } else if (
      !["--json", "--portable", "--strict", "--help", "-h"].includes(args[i])
    ) {
      throw new Error(`unknown argument: ${args[i]}`);
    }
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: node scripts/check-note-surface.ts --file NOTE [--portable] [--strict] [--json]"
    );
    console.log("       node scripts/check-note-surface.ts --self-test");
    return 0;
  }
  if (files.length === 0) {
    throw new Error("usage: node scripts/check-note-surface.ts --file NOTE");
  }
  const results = files.map((file) => check(file, portable, strict));
  const merged: Evidence = evidence(
    "check-note-surface",
    results.every((result) => result.gate === "passed") ? "passed" : "failed",
    { paths: files, portable, strict },
    {
      files: files.length,
      passed: results.filter((result) => result.gate === "passed").length,
    },
    results.flatMap((result) => result.findings),
    Object.fromEntries(
      results.map((result) => [String(result.input.path), result])
    )
  );
  if (json) {
    printEvidence(merged, true, "");
  } else {
    const errors = merged.findings.filter((item) => item.severity === "error");
    if (errors.length > 0) {
      for (const item of errors) {
        console.error(
          `ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`
        );
      }
    } else {
      console.log(
        `OK: checked ${files.length} note(s); Markdown/Obsidian surface is valid`
      );
    }
  }
  return exitForGate(merged.gate);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
