#!/usr/bin/env node
// Node 24+ runs this TypeScript directly with its built-in type stripping.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

type Heading = { line: number; level: number; text: string };

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)\s*$/;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\s+#+\s*$/, "");
}

function readTitle(file: string): string {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return path.basename(file, ".md");
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---") break;
    const match = line.match(/^title:\s*["']?(.*?)["']?\s*$/);
    if (match) return normalize(match[1]);
  }
  return path.basename(file, ".md");
}

function headings(file: string): Heading[] {
  const result: Heading[] = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let inFrontmatter = lines[0]?.trim() === "---";
  let inFence = false;
  lines.forEach((line: string, index: number) => {
    const trimmed = line.trimStart();
    if (inFrontmatter) {
      if (index > 0 && line.trim() === "---") inFrontmatter = false;
      return;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = line.match(HEADING_RE);
    if (match) result.push({ line: index + 1, level: match[1].length, text: normalize(match[2]) });
  });
  return result;
}

function check(file: string, strict: boolean): string[] {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return [`${file}: file does not exist`];
  const hs = headings(file);
  const errors: string[] = [];
  if (hs.length === 0) errors.push(`${file}: no Markdown headings found`);
  if (hs.length > 0 && hs[0].level !== 1) errors.push(`${file}:${hs[0].line}: first heading must be level 1`);
  for (let i = 1; i < hs.length; i += 1) {
    if (hs[i].level > hs[i - 1].level + 1) {
      errors.push(`${file}:${hs[i].line}: heading jumps from H${hs[i - 1].level} to H${hs[i].level}`);
    }
  }

  const rootCount = hs.filter((heading) => heading.level === 1).length;
  const title = readTitle(file);
  if (strict && rootCount === 1 && hs[0].text !== title && hs.length > 1) {
    errors.push(
      `${file}:${hs[0].line}: one substantive H1 contains all other headings; use the implicit-title convention with sibling H1 chapters or make the first H1 match the note title`
    );
  }
  return errors;
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
      const passed = check(file, true).length === 0;
      if (passed !== expectedPass) throw new Error(`self-test case failed: ${JSON.stringify(body)}`);
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
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") files.push(path.resolve(args[++i] ?? ""));
    else if (args[i] !== "--strict" && args[i] !== "--help" && args[i] !== "-h") {
      throw new Error(`unknown argument: ${args[i]}`);
    }
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/check-heading-tree.ts --strict --file NOTE [--file NOTE ...]");
    console.log("       node scripts/check-heading-tree.ts --self-test");
    return 0;
  }
  if (files.length === 0) throw new Error("usage: node scripts/check-heading-tree.ts --strict --file NOTE");
  const errors = files.flatMap((file) => check(file, strict));
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`ERROR ${error}`));
    return 1;
  }
  console.log(`OK: checked ${files.length} note(s); heading tree is structurally valid`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
