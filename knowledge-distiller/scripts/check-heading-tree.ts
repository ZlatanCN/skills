#!/usr/bin/env node
// Node 24+ runs this TypeScript directly with its built-in type stripping.

import * as fs from "node:fs";
import path from "node:path";

import {
  evidence,
  exitForGate,
  finding,
  runMain,
  withTempDir,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";
import { frontmatterTitle, key, parseMarkdown } from "./lib/markdown.ts";
import type { Heading } from "./lib/markdown.ts";

function check(fileInput: string, strict: boolean): Evidence {
  const file = path.resolve(fileInput);
  const findings: Finding[] = [];
  if (!fs.existsSync(file)) {
    findings.push(
      finding("file-missing", "error", "note file does not exist", {
        path: file,
      })
    );
    return evidence(
      "check-heading-tree",
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
      "check-heading-tree",
      "failed",
      { path: file },
      {},
      findings
    );
  }

  const surface = parseMarkdown(file);
  for (const parseError of surface.parse_errors) {
    findings.push(
      finding(parseError.code, "error", parseError.message, {
        line: parseError.line,
        path: file,
      })
    );
  }
  const { headings } = surface;
  if (headings.length === 0) {
    findings.push(
      finding("heading-missing", "error", "no Markdown headings found", {
        path: file,
      })
    );
  } else if (headings[0].level !== 1) {
    findings.push(
      finding("heading-root-level", "error", "first heading must be level 1", {
        line: headings[0].line,
        path: file,
      })
    );
  }
  for (let i = 1; i < headings.length; i += 1) {
    const previous = headings[i - 1];
    const current = headings[i];
    if (current.level > previous.level + 1) {
      findings.push(
        finding(
          "heading-level-jump",
          "error",
          `heading jumps from H${previous.level} to H${current.level}`,
          {
            evidence: {
              current_level: current.level,
              previous_level: previous.level,
              previous_line: previous.line,
            },
            line: current.line,
            path: file,
          }
        )
      );
    }
  }

  const rootCount = headings.filter((heading) => heading.level === 1).length;
  const filenameTitle = path.basename(file, ".md");
  const metadataTitle = frontmatterTitle(surface);
  const title = key(filenameTitle);
  if (strict) {
    if (metadataTitle && key(metadataTitle) !== title) {
      findings.push(
        finding(
          "frontmatter-title-mismatch",
          "error",
          "frontmatter title must match the filename; the filename is the implicit document title",
          {
            evidence: {
              filename_title: filenameTitle,
              frontmatter_title: metadataTitle,
            },
            path: file,
          }
        )
      );
    }
    for (const heading of headings) {
      if (heading.level === 1 && heading.key === title) {
        findings.push(
          finding(
            "body-title-duplicate",
            "error",
            "the filename is the implicit document title; do not repeat it as a body H1",
            {
              evidence: { heading: heading.text, note_title: filenameTitle },
              line: heading.line,
              path: file,
            }
          )
        );
      }
    }
  }

  const duplicateHeadings = new Map<string, Heading[]>();
  for (const heading of headings) {
    duplicateHeadings.set(heading.key, [
      ...(duplicateHeadings.get(heading.key) ?? []),
      heading,
    ]);
  }
  for (const [headingKey, matches] of duplicateHeadings) {
    if (matches.length > 1) {
      findings.push(
        finding(
          "heading-duplicate",
          "warning",
          `heading text is duplicated ${matches.length} times; anchored links may be ambiguous`,
          {
            evidence: {
              heading: headingKey,
              lines: matches.map((match) => match.line),
            },
            line: matches[1].line,
            path: file,
          }
        )
      );
    }
  }

  const errors = findings.filter((item) => item.severity === "error");
  return evidence(
    "check-heading-tree",
    errors.length === 0 ? "passed" : "failed",
    {
      path: file,
      sha256: surface.content_hash,
      strict,
    },
    {
      heading_count: headings.length,
      root_count: rootCount,
    },
    findings
  );
}
function selfTest(): number {
  return withTempDir("knowledge-distiller-heading-", (root) => {
    const cases: [string, boolean][] = [
      ["---\ntitle: Good\n---\n# Chapter\n## Detail\n### Example\n", true],
      [
        "---\ntitle: Good\n---\n# Chapter A\n## Detail\n# Chapter B\n## Detail\n",
        true,
      ],
      ["---\ntitle: Good\n---\n# Good\n## Chapter\n", false],
      [
        "---\ntitle: Bad\n---\n# Chapter A\n## Chapter B\n## Chapter C\n",
        false,
      ],
      ["# Good\n## Chapter\n", false],
      ["# Chapter\n## Child\n", true],
      ["# Good\n### skipped\n", false],
      ["```\n# Fake\n```\n# Real\n", true],
    ];
    for (const [body, expectedPass] of cases) {
      const file = path.join(root, "Good.md");
      fs.writeFileSync(file, body, "utf-8");
      const result = check(file, true);
      if ((result.gate === "passed") !== expectedPass) {
        throw new Error(`self-test case failed: ${JSON.stringify(body)}`);
      }
    }

    const spaced = path.join(root, "My  Note.md");
    fs.writeFileSync(spaced, "# My Note\n## Chapter\n", "utf-8");
    if (check(spaced, true).gate !== "failed") {
      throw new Error("filename whitespace duplicate should fail");
    }

    const mismatched = path.join(root, "Note.md");
    fs.writeFileSync(
      mismatched,
      "---\ntitle: Other\n---\n# Note\n## Chapter\n",
      "utf-8"
    );
    if (check(mismatched, true).gate !== "failed") {
      throw new Error("frontmatter title mismatch should fail");
    }

    console.log("heading-tree checker self-test: PASS");
    return 0;
  });
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    return selfTest();
  }
  const strict = args.includes("--strict");
  const json = args.includes("--json");
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") {
      i += 1;
      files.push(path.resolve(args[i] ?? ""));
    } else if (!["--strict", "--json", "--help", "-h"].includes(args[i])) {
      throw new Error(`unknown argument: ${args[i]}`);
    }
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: node scripts/check-heading-tree.ts --strict --file NOTE [--file NOTE ...] [--json]"
    );
    console.log("       node scripts/check-heading-tree.ts --self-test");
    return 0;
  }
  if (files.length === 0) {
    throw new Error(
      "usage: node scripts/check-heading-tree.ts --strict --file NOTE"
    );
  }
  const results = files.map((file) => check(file, strict));
  const merged: Evidence = evidence(
    "check-heading-tree",
    results.every((result) => result.gate === "passed") ? "passed" : "failed",
    { paths: files },
    {
      files: files.length,
      passed: results.filter((result) => result.gate === "passed").length,
    },
    results.flatMap((result) => result.findings),
    Object.fromEntries(
      results.map((result) => [String(result.input.path), result])
    )
  );
  const humanErrors = merged.findings.filter(
    (item) => item.severity === "error"
  );
  if (json) {
    console.log(JSON.stringify(merged, null, 2));
  } else if (humanErrors.length > 0) {
    for (const item of humanErrors) {
      console.error(
        `ERROR ${item.path ?? ""}:${item.line ?? 0}: ${item.message}`
      );
    }
  } else {
    console.log(
      `OK: checked ${files.length} note(s); heading tree is structurally valid`
    );
  }
  return exitForGate(merged.gate);
}

runMain(main);
