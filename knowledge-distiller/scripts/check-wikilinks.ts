#!/usr/bin/env node
// Node 24+ runs this TypeScript directly with its built-in type stripping.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

type ErrorItem = { file: string; line: number; message: string };
type Heading = { line: number; text: string; key: string };
type BlockId = { line: number; id: string };
type ParsedNote = {
  visibleLines: Array<[number, string]>;
  headings: Heading[];
  blockIds: BlockId[];
  parseErrors: ErrorItem[];
};
type Note = {
  relativePath: string;
  relativeKey: string;
  realpath: string;
  basename: string;
  basenameKey: string;
  contentHash: string;
  headings: Heading[];
  blockIds: BlockId[];
  parseErrors: ErrorItem[];
  visibleLines: Array<[number, string]>;
};
type Manifest = {
  rootRealpath: string;
  exclusions: string[];
  errors: string[];
  scanStatus: "complete" | "partial";
  notes: Note[];
  duplicateKeys: string[];
  manifestHash: string;
};

const LINK_RE = /\[\[([^\]\n]+)\]\]/g;
const HEADING_RE = /^(#{1,6})[ \t]+(.+?)\s*$/;
const BLOCK_ID_RE = /(?:^|[ \t])\^([A-Za-z0-9_-]+)[ \t]*$/;
const LEGAL_BLOCK_ID_RE = /^[A-Za-z0-9_-]+$/;
const EXCLUDED_DIRS = new Set([
  ".git",
  ".obsidian",
  ".agents",
  ".codex",
  "node_modules",
  "dist",
  "build",
  "generated",
  "artifacts",
]);
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function normalizedWhitespace(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function headingKey(value: string): string {
  return normalizedWhitespace(value);
}

function filenameKey(value: string): string {
  return normalizedWhitespace(value).toLowerCase();
}

function relativeKey(relativePath: string): string {
  return relativePath.split(path.sep).join("/").normalize("NFKC");
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function maskInlineCode(line: string): string {
  const output = [...line];
  let codeRun = 0;
  let index = 0;
  while (index < line.length) {
    if (line[index] === "`" && (index === 0 || line[index - 1] !== "\\")) {
      let run = 1;
      while (index + run < line.length && line[index + run] === "`") run += 1;
      if (codeRun === 0) {
        codeRun = run;
        for (let offset = 0; offset < run; offset += 1) output[index + offset] = " ";
      } else if (run === codeRun) {
        for (let offset = 0; offset < run; offset += 1) output[index + offset] = " ";
        codeRun = 0;
      } else {
        for (let offset = 0; offset < run; offset += 1) output[index + offset] = " ";
      }
      index += run;
      continue;
    }
    if (codeRun > 0) output[index] = " ";
    index += 1;
  }
  return output.join("");
}

function parseMarkdown(file: string): ParsedNote {
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const visibleLines: Array<[number, string]> = [];
  const headings: Heading[] = [];
  const blockIds: BlockId[] = [];
  const parseErrors: ErrorItem[] = [];
  let inFrontmatter = lines[0]?.trim() === "---";
  let frontmatterClosed = !inFrontmatter;
  let fenceChar = "";
  let fenceLength = 0;

  lines.forEach((rawLine: string, index: number) => {
    const line = index === 0 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
    const lineNumber = index + 1;
    const trimmed = line.trimStart();

    if (inFrontmatter) {
      if (lineNumber > 1 && (line.trim() === "---" || line.trim() === "...")) {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      return;
    }

    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      if (!fenceChar) {
        fenceChar = marker;
        fenceLength = length;
      } else if (marker === fenceChar && length >= fenceLength) {
        fenceChar = "";
        fenceLength = 0;
      }
      return;
    }
    if (fenceChar) return;

    const visible = maskInlineCode(line);
    visibleLines.push([lineNumber, visible]);
    const heading = visible.match(HEADING_RE);
    if (heading) {
      const text = heading[2].trim();
      headings.push({ line: lineNumber, text, key: headingKey(text) });
    } else {
      const blockId = visible.match(BLOCK_ID_RE);
      if (blockId) blockIds.push({ line: lineNumber, id: blockId[1] });
    }
  });

  if (!frontmatterClosed) {
    parseErrors.push({ file, line: 1, message: "unterminated YAML frontmatter" });
  }
  if (fenceChar) {
    parseErrors.push({ file, line: lines.length, message: "unterminated fenced code block" });
  }
  return { visibleLines, headings, blockIds, parseErrors };
}

function noteFromFile(root: string, file: string): Note {
  const bytes = fs.readFileSync(file);
  const parsed = parseMarkdown(file);
  const relativePath = path.relative(root, file).split(path.sep).join("/");
  const basename = path.basename(file, ".md");
  return {
    relativePath,
    relativeKey: relativeKey(relativePath),
    realpath: fs.realpathSync(file),
    basename,
    basenameKey: filenameKey(basename),
    contentHash: hashBytes(bytes),
    headings: parsed.headings,
    blockIds: parsed.blockIds,
    parseErrors: parsed.parseErrors,
    visibleLines: parsed.visibleLines,
  };
}

function scanManifest(rootInput: string, includeSkillDir = false): Manifest {
  const rootRealpath = fs.realpathSync(rootInput);
  const files: string[] = [];
  const errors: string[] = [];

  function visit(directory: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      errors.push(`${directory}: cannot read directory: ${(error as Error).message}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (!includeSkillDir && !samePath(rootRealpath, SKILL_DIR) && samePath(full, SKILL_DIR)) continue;
        visit(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      try {
        const real = fs.realpathSync(full);
        if (!inside(rootRealpath, real)) {
          errors.push(`${full}: resolved file escapes the vault root`);
          continue;
        }
        files.push(full);
      } catch (error) {
        errors.push(`${full}: cannot resolve file: ${(error as Error).message}`);
      }
    }
  }

  visit(rootRealpath);
  files.sort((left, right) => relativeKey(path.relative(rootRealpath, left)).localeCompare(relativeKey(path.relative(rootRealpath, right))));

  const notes: Note[] = [];
  for (const file of files) {
    try {
      notes.push(noteFromFile(rootRealpath, file));
    } catch (error) {
      errors.push(`${file}: cannot read or parse note: ${(error as Error).message}`);
    }
  }

  const basenameGroups = new Map<string, Note[]>();
  for (const note of notes) {
    const group = basenameGroups.get(note.basenameKey) ?? [];
    group.push(note);
    basenameGroups.set(note.basenameKey, group);
  }
  const duplicateKeys = [...basenameGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key]) => key)
    .sort();

  const manifestBody = notes
    .slice()
    .sort((left, right) => left.relativeKey.localeCompare(right.relativeKey))
    .map((note) => ({
      relative_path: note.relativeKey,
      realpath: note.realpath,
      basename: note.basename,
      content_hash: note.contentHash,
      headings: note.headings,
      block_ids: note.blockIds,
    }));
  const canonical = JSON.stringify(manifestBody);
  return {
    rootRealpath,
    exclusions: [...EXCLUDED_DIRS].sort(),
    errors,
    scanStatus: errors.length === 0 ? "complete" : "partial",
    notes,
    duplicateKeys,
    manifestHash: hashBytes(Buffer.from(canonical, "utf8")),
  };
}

function normalizeTargetPath(rawTarget: string): { value?: string; error?: string } {
  let target = rawTarget.normalize("NFKC").trim().replace(/\\/g, "/");
  if (target.startsWith("/") || target.split("/").includes("..")) {
    return { error: "target path escapes the vault or is not supported" };
  }
  while (target.startsWith("./")) target = target.slice(2);
  if (target.endsWith(".md")) target = target.slice(0, -3);
  if (!target) return { error: "target note does not exist" };
  const parts = target.split("/");
  if (parts.some((part) => !part || part === ".")) return { error: "target path is not normalized" };
  return { value: `${parts.join("/")}.md` };
}

function resolveTarget(manifest: Manifest, current: Note, rawTarget: string): [Note | null, string | null] {
  if (!rawTarget) return [current, null];
  const normalized = normalizeTargetPath(rawTarget);
  if (normalized.error) return [null, normalized.error];
  const target = normalized.value as string;
  if (target.includes("/")) {
    const wanted = relativeKey(target);
    const matches = manifest.notes.filter((note) => note.relativeKey === wanted);
    if (matches.length === 1) return [matches[0], null];
    if (matches.length > 1) return [null, "ambiguous target path"];
    return [null, "target note does not exist at the specified path"];
  }
  const wanted = filenameKey(path.basename(target, ".md"));
  const matches = manifest.notes.filter((note) => note.basenameKey === wanted);
  if (matches.length === 1) return [matches[0], null];
  if (matches.length > 1) return [null, `ambiguous target (${matches.length} notes have this filename)`];
  return [null, "target note does not exist"];
}

function checkFile(manifest: Manifest, suppliedFile: string): ErrorItem[] {
  const file = path.resolve(suppliedFile);
  if (!fs.existsSync(file)) return [{ file, line: 0, message: "file does not exist" }];
  const stat = fs.lstatSync(file);
  if (!inside(manifest.rootRealpath, file) || stat.isSymbolicLink() || !stat.isFile()) {
    return [{ file, line: 0, message: "file is not a regular Markdown note in the canonical manifest" }];
  }
  const real = fs.realpathSync(file);
  const current = manifest.notes.find((note) => note.realpath === real);
  if (!current) return [{ file, line: 0, message: "file is not a regular Markdown note in the canonical manifest" }];

  const errors: ErrorItem[] = [...current.parseErrors];
  for (const [line, text] of current.visibleLines) {
    for (const match of text.matchAll(LINK_RE)) {
      const raw = match[1];
      const body = raw.split("|", 1)[0].trim();
      const separator = body.indexOf("#");
      if (separator < 0 || separator === body.length - 1) {
        errors.push({ file, line, message: `[[${raw}]]: bare wikilink; add an exact heading or block anchor` });
        continue;
      }

      const targetName = body.slice(0, separator).trim();
      const anchor = body.slice(separator + 1).trim();
      const [resolved, reason] = resolveTarget(manifest, current, targetName);
      if (!resolved) {
        errors.push({ file, line, message: `[[${raw}]]: ${reason}` });
        continue;
      }
      if (resolved.parseErrors.length > 0) {
        errors.push({ file, line, message: `[[${raw}]]: target note has parse errors and cannot provide a deterministic anchor` });
        continue;
      }

      if (anchor.startsWith("^")) {
        const blockId = anchor.slice(1);
        if (!LEGAL_BLOCK_ID_RE.test(blockId)) {
          errors.push({ file, line, message: `[[${raw}]]: block ID must match [A-Za-z0-9_-]+` });
          continue;
        }
        const matches = resolved.blockIds.filter((block) => block.id === blockId);
        if (matches.length !== 1) {
          errors.push({
            file,
            line,
            message: matches.length === 0
              ? `[[${raw}]]: block anchor does not exist in the target note`
              : `[[${raw}]]: block anchor is duplicated in the target note`,
          });
        }
        continue;
      }

      const wantedHeading = headingKey(anchor);
      const matches = resolved.headings.filter((heading) => heading.key === wantedHeading);
      if (matches.length !== 1) {
        errors.push({
          file,
          line,
          message: matches.length === 0
            ? `[[${raw}]]: heading anchor does not exist in the target note`
            : `[[${raw}]]: heading anchor is duplicated in the target note`,
        });
      }
    }
  }
  return errors;
}

function summary(manifest: Manifest, checked: number, errors: ErrorItem[] = []): Record<string, unknown> {
  return {
    ok: manifest.scanStatus === "complete" && errors.length === 0,
    checked,
    root_realpath: manifest.rootRealpath,
    scan_status: manifest.scanStatus,
    manifest_hash: manifest.manifestHash,
    note_count: manifest.notes.length,
    duplicate_keys: manifest.duplicateKeys,
    exclusions: manifest.exclusions,
    scan_errors: manifest.errors,
    errors,
  };
}

function printErrors(errors: ErrorItem[]): void {
  for (const error of errors) console.error(`ERROR ${error.file}:${error.line}: ${error.message}`);
}

function main(): number {
  const args = process.argv.slice(2);
  let vault = "";
  let json = false;
  let includeSkillDir = false;
  const requested: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log("usage: node scripts/check-wikilinks.ts --vault-root VAULT --file NOTE [--file NOTE ...] [--json]");
      console.log("       node scripts/check-wikilinks.ts --self-test");
      return 0;
    }
    if (args[i] === "--self-test") return selfTest();
    if (args[i] === "--json") json = true;
    else if (args[i] === "--include-skill-dir") includeSkillDir = true;
    else if (args[i] === "--vault-root") {
      vault = args[++i] ?? "";
      if (!vault || vault.startsWith("--")) throw new Error("--vault-root requires a directory");
    }
    else if (args[i] === "--file") {
      const file = args[++i] ?? "";
      if (!file || file.startsWith("--")) throw new Error("--file requires a note path");
      requested.push(file);
    }
    else throw new Error(`unknown argument: ${args[i]}`);
  }
  if (!vault || requested.length === 0) throw new Error("usage: node scripts/check-wikilinks.ts --vault-root VAULT --file NOTE");
  vault = path.resolve(vault);
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) throw new Error(`vault root is not a directory: ${vault}`);

  const manifest = scanManifest(vault, includeSkillDir);
  const errors: ErrorItem[] = [];
  for (const supplied of requested) {
    const file = path.resolve(supplied);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) errors.push({ file, line: 0, message: "file does not exist" });
    else errors.push(...checkFile(manifest, file));
  }
  if (json) console.log(JSON.stringify(summary(manifest, requested.length, errors), null, 2));
  if (manifest.errors.length > 0) {
    if (!json) printErrors(manifest.errors.map((message) => ({ file: vault, line: 0, message })));
    return 2;
  }
  if (errors.length > 0) {
    if (!json) printErrors(errors);
    return 1;
  }
  if (!json) console.log(`OK: checked ${requested.length} note(s); manifest=${manifest.manifestHash}; all wikilinks resolve to unique anchored positions`);
  return 0;
}

function assertSelfTest(condition: boolean, message: string): void {
  if (!condition) throw new Error(`self-test failed: ${message}`);
}

function selfTest(): number {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-distiller-wikilink-"));
  try {
    fs.mkdirSync(path.join(root, "one"));
    fs.mkdirSync(path.join(root, "two"));
    fs.mkdirSync(path.join(root, "generated"));
    fs.mkdirSync(path.join(root, ".agents"));
    fs.writeFileSync(path.join(root, "Target.md"), [
      "---",
      "title: '# Frontmatter Heading'",
      "# Frontmatter Heading",
      "---",
      "```markdown",
      "# Fenced Heading",
      "text ^fenced-block",
      "```",
      "# Real Heading",
      "Paragraph ^block-1",
      "Inline `[[Target#Not An Anchor|code]]` and `^inline-block`.",
      "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(root, "DuplicateHeading.md"), "# Same\n# Same\n", "utf8");
    fs.writeFileSync(path.join(root, "DuplicateBlock.md"), "# Blocks\nfirst ^duplicate\nsecond ^duplicate\n", "utf8");
    fs.writeFileSync(path.join(root, "one", "Duplicate.md"), "# Real Heading\n", "utf8");
    fs.writeFileSync(path.join(root, "two", "Duplicate.md"), "# Real Heading\n", "utf8");
    fs.writeFileSync(path.join(root, "generated", "Hidden.md"), "# Hidden\n", "utf8");
    fs.writeFileSync(path.join(root, ".agents", "Excluded.md"), "# Excluded\n", "utf8");
    const symlink = path.join(root, "Alias.md");
    try { fs.symlinkSync("Target.md", symlink); } catch { /* symlinks may be unavailable; other cases remain meaningful */ }

    const manifest = scanManifest(root, true);
    assertSelfTest(manifest.scanStatus === "complete", "fixture scan should be complete");
    assertSelfTest(manifest.notes.every((note) => !note.relativePath.startsWith("generated/")), "generated notes must be excluded");
    assertSelfTest(manifest.notes.every((note) => !note.relativePath.startsWith(".agents/")), "excluded directories must be absent");
    assertSelfTest(manifest.duplicateKeys.includes("duplicate"), "duplicate basename must be recorded");
    const target = manifest.notes.find((note) => note.relativePath === "Target.md");
    assertSelfTest(Boolean(target), "target note must be in the manifest");
    assertSelfTest(target?.headings.length === 1 && target.headings[0].text === "Real Heading", "frontmatter/fence headings must be ignored");
    assertSelfTest(target?.blockIds.length === 1 && target.blockIds[0].id === "block-1", "frontmatter/fence/inline block IDs must be ignored");

    const note = path.join(root, "Note.md");
    const run = (body: string): ErrorItem[] => {
      fs.writeFileSync(note, body, "utf8");
      const currentManifest = scanManifest(root, true);
      return checkFile(currentManifest, note);
    };
    assertSelfTest(run([
      "# Local",
      "[[Target#Real Heading|heading]]",
      "[[Target#^block-1|block]]",
      "[[#Local|local]]",
      "`[[Missing#Nope|inline code]]`",
      "```",
      "[[Missing#Nope|fenced code]]",
      "```",
    ].join("\n")).length === 0, "valid links and code exclusions should pass");
    assertSelfTest(run("[[Target#Frontmatter Heading|bad]]").length > 0, "frontmatter heading must not resolve");
    assertSelfTest(run("[[Target#Fenced Heading|bad]]").length > 0, "fenced heading must not resolve");
    assertSelfTest(run("[[Target#^fenced-block|bad]]").length > 0, "fenced block ID must not resolve");
    assertSelfTest(run("[[DuplicateHeading#Same|bad]]").some((error) => error.message.includes("duplicated")), "duplicate heading must fail");
    assertSelfTest(run("[[DuplicateBlock#^duplicate|bad]]").some((error) => error.message.includes("duplicated")), "duplicate block ID must fail");
    assertSelfTest(run("[[Duplicate#Real Heading|bad]]").some((error) => error.message.includes("ambiguous")), "duplicate basename must fail");
    assertSelfTest(run("[[one/Duplicate#Real Heading|qualified]]").length === 0, "unique path-qualified target should pass");
    assertSelfTest(run("[[generated/Hidden#Hidden|excluded]]").length > 0, "excluded target must not resolve");
    assertSelfTest(run("[[../Target#Real Heading|escape]]").length > 0, "path traversal must fail");
    assertSelfTest(run("[[Target#^bad.id|illegal block]]").length > 0, "illegal block ID must fail");
    if (fs.existsSync(symlink)) assertSelfTest(run("[[Alias#Real Heading|symlink]]").length > 0, "symlink target must be absent");

    const source = path.join(root, "one", "Source.md");
    fs.writeFileSync(source, "[[Duplicate#Real Heading|shortcut]]\n", "utf8");
    const sourceManifest = scanManifest(root, true);
    assertSelfTest(checkFile(sourceManifest, source).some((error) => error.message.includes("ambiguous")), "current-directory shortcut must not bypass global ambiguity");
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
