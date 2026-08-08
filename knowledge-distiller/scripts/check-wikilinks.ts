#!/usr/bin/env node
// Node 24+ runs this TypeScript directly with its built-in type stripping.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

type ErrorItem = { file: string; line: number; message: string };

const LINK_RE = /\[\[([^\]\n]+)\]\]/g;
const HEADING_RE = /^#{1,6}[ \t]+(.+?)\s*$/;
const SKIP_DIRS = new Set([".git", ".obsidian", ".agents", ".codex", "node_modules"]);

function headingKey(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function walk(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) result.push(full);
  }
  return result;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function markdownLines(file: string): Array<[number, string]> {
  const result: Array<[number, string]> = [];
  let inFence = false;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line: string, index: number) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      return;
    }
    if (!inFence) result.push([index + 1, line]);
  });
  return result;
}

function resolveTarget(vault: string, current: string, target: string, notes: string[]): [string | null, string | null] {
  if (!target) return [current, null];
  const clean = target.replace(/^\.\//, "").replace(/\.md$/, "");
  if (path.isAbsolute(clean) || clean.split(/[\\/]/).includes("..")) return [null, "target path escapes the vault or is not supported"];
  const directCandidates = new Set([
    path.join(vault, `${clean}.md`),
    ...(inside(vault, current) ? [path.join(path.dirname(current), `${clean}.md`)] : []),
  ]);
  const direct = [...directCandidates]
    .filter((candidate) => inside(vault, candidate))
    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (direct.length === 1) return [direct[0], null];
  if (direct.length > 1) return [null, "ambiguous target (relative and vault-root paths both exist)"];

  if (clean.includes("/") || clean.includes("\\")) return [null, "target note does not exist at the specified path"];
  const wanted = path.basename(clean);
  const candidates = notes.filter((note) => path.basename(note, ".md") === wanted);
  if (candidates.length === 1) return [candidates[0], null];
  if (candidates.length > 1) return [null, `ambiguous target (${candidates.length} notes have this filename)`];
  return [null, "target note does not exist"];
}

function checkFile(vault: string, file: string, notes: string[]): ErrorItem[] {
  const errors: ErrorItem[] = [];
  for (const [line, text] of markdownLines(file)) {
    for (const match of text.matchAll(LINK_RE)) {
      const raw = match[1];
      const body = raw.split("|", 1)[0];
      const separator = body.indexOf("#");
      if (separator < 0 || separator === body.length - 1) {
        errors.push({ file, line, message: `[[${raw}]]: bare wikilink; add an exact heading or block anchor` });
        continue;
      }

      const target = body.slice(0, separator);
      const anchor = body.slice(separator + 1);
      const [resolved, reason] = resolveTarget(vault, file, target, notes);
      if (!resolved) {
        errors.push({ file, line, message: `[[${raw}]]: ${reason}` });
        continue;
      }

      const targetLines = markdownLines(resolved).map(([, targetLine]) => targetLine);
      const targetText = targetLines.join("\n");
      let found = false;
      if (anchor.startsWith("^")) {
        const blockId = anchor.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        found = new RegExp(`(?:^|\\s)\\^${blockId}(?=\\s|$)`, "m").test(targetText);
      } else {
        const headings = new Set<string>();
        for (const targetLine of targetLines) {
          const heading = targetLine.match(HEADING_RE);
          if (heading) headings.add(headingKey(heading[1]));
        }
        found = headings.has(headingKey(anchor));
      }
      if (!found) errors.push({ file, line, message: `[[${raw}]]: anchor does not exist in the target note` });
    }
  }
  return errors;
}

function main(): number {
  const args = process.argv.slice(2);
  let vault = "";
  const requested: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log("usage: node scripts/check-wikilinks.ts --vault-root VAULT --file NOTE [--file NOTE ...]");
      console.log("       node scripts/check-wikilinks.ts --self-test");
      return 0;
    }
    if (args[i] === "--self-test") return selfTest();
    if (args[i] === "--vault-root") vault = args[++i] ?? "";
    else if (args[i] === "--file") requested.push(args[++i] ?? "");
    else throw new Error(`unknown argument: ${args[i]}`);
  }
  if (!vault || requested.length === 0) throw new Error("usage: node scripts/check-wikilinks.ts --vault-root VAULT --file NOTE");
  vault = path.resolve(vault);
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) throw new Error(`vault root is not a directory: ${vault}`);

  const notes = walk(vault);
  const errors: ErrorItem[] = [];
  for (const supplied of requested) {
    const file = path.resolve(supplied);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) errors.push({ file, line: 0, message: "file does not exist" });
    else errors.push(...checkFile(vault, file, notes));
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error.file}:${error.line}: ${error.message}`);
    return 1;
  }
  console.log(`OK: checked ${requested.length} note(s); all wikilinks resolve to anchored positions`);
  return 0;
}

function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-wikilink-"));
  try {
    fs.mkdirSync(path.join(root, "one"));
    fs.mkdirSync(path.join(root, "two"));
    fs.writeFileSync(path.join(root, "Target.md"), "```\n# Fake Heading\ntext ^fake-block\n```\n# Real Heading\ntext ^block-1\n", "utf8");
    fs.writeFileSync(path.join(root, "one", "Duplicate.md"), "# Real Heading\n", "utf8");
    fs.writeFileSync(path.join(root, "two", "Duplicate.md"), "# Real Heading\n", "utf8");
    const note = path.join(root, "Note.md");
    const notes = walk(root);
    const cases: Array<[string, boolean]> = [
      ["[[Target#Real Heading|ok]]\n[[Target#^block-1|ok]]", true],
      ["# Local\n[[#Local|ok]]\n```\n[[Missing#Nope|code]]\n```", true],
      ["[[Missing#Nope|bad]]", false],
      ["[[Target#Missing|bad]]", false],
      ["[[Target#Fake Heading|code heading]]", false],
      ["[[Target#^fake-block|code block]]", false],
      ["[[Target|bare]]", false],
      ["[[Duplicate#Real Heading|ambiguous]]", false],
      ["[[../Target#Real Heading|escape]]", false],
    ];
    for (const [body, expectedPass] of cases) {
      fs.writeFileSync(note, body, "utf8");
      const passed = checkFile(root, note, notes).length === 0;
      if (passed !== expectedPass) throw new Error(`self-test case failed: ${body}`);
    }
    console.log("wikilink checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
