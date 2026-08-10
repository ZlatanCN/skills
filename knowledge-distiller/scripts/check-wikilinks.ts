#!/usr/bin/env node
// Node 24+ runs this TypeScript directly with its built-in type stripping.

import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import { evidence, exitForGate, finding, sha256 } from "./lib/evidence.ts";
import type { Evidence } from "./lib/evidence.ts";
import { key, maskInlineCode, parseMarkdown } from "./lib/markdown.ts";
import type { BlockId, Heading } from "./lib/markdown.ts";

type ErrorItem = { file: string; line: number; message: string };
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
  visibleLines: [number, string][];
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

const LINK_RE = /\[\[(?<raw>[^\]\n]+)\]\]/gu;
const LEGAL_BLOCK_ID_RE = /^[A-Za-z0-9_-]+$/u;
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
const SKILL_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  ".."
);

function filenameKey(value: string): string {
  return key(value).toLowerCase();
}

function relativeKey(relativePath: string): string {
  return relativePath.split(path.sep).join("/").normalize("NFKC");
}

function hashBytes(bytes: Buffer): string {
  return sha256(bytes);
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function noteFromFile(root: string, file: string): Note {
  const bytes = fs.readFileSync(file);
  const parsed = parseMarkdown(file);
  const relativePath = path.relative(root, file).split(path.sep).join("/");
  const basename = path.basename(file, ".md");
  return {
    basename,
    basenameKey: filenameKey(basename),
    blockIds: parsed.block_ids,
    contentHash: hashBytes(bytes),
    headings: parsed.headings,
    parseErrors: parsed.parse_errors.map((item) => ({
      file,
      line: item.line,
      message: item.message,
    })),
    realpath: fs.realpathSync(file),
    relativeKey: relativeKey(relativePath),
    relativePath,
    visibleLines: parsed.body_lines.map(([line, text]) => [
      line,
      maskInlineCode(text),
    ]),
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
      errors.push(
        `${directory}: cannot read directory: ${(error as Error).message}`
      );
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        if (
          !includeSkillDir &&
          !samePath(rootRealpath, SKILL_DIR) &&
          samePath(full, SKILL_DIR)
        ) {
          continue;
        }
        visit(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }
      try {
        const real = fs.realpathSync(full);
        if (!inside(rootRealpath, real)) {
          errors.push(`${full}: resolved file escapes the vault root`);
          continue;
        }
        files.push(full);
      } catch (error) {
        errors.push(
          `${full}: cannot resolve file: ${(error as Error).message}`
        );
      }
    }
  }

  visit(rootRealpath);
  const sortedFiles = files.toSorted((left, right) =>
    relativeKey(path.relative(rootRealpath, left)).localeCompare(
      relativeKey(path.relative(rootRealpath, right))
    )
  );

  const notes: Note[] = [];
  for (const file of sortedFiles) {
    try {
      notes.push(noteFromFile(rootRealpath, file));
    } catch (error) {
      errors.push(
        `${file}: cannot read or parse note: ${(error as Error).message}`
      );
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
    .map(([duplicateKey]) => duplicateKey)
    .toSorted();

  const manifestBody = [...notes]
    .toSorted((left, right) =>
      left.relativeKey.localeCompare(right.relativeKey)
    )
    .map((note) => ({
      basename: note.basename,
      block_ids: note.blockIds,
      content_hash: note.contentHash,
      headings: note.headings,
      realpath: note.realpath,
      relative_path: note.relativeKey,
    }));
  const canonical = JSON.stringify(manifestBody);
  return {
    duplicateKeys,
    errors,
    exclusions: [...EXCLUDED_DIRS].toSorted(),
    manifestHash: hashBytes(Buffer.from(canonical, "utf-8")),
    notes,
    rootRealpath,
    scanStatus: errors.length === 0 ? "complete" : "partial",
  };
}

function normalizeTargetPath(rawTarget: string): {
  value?: string;
  error?: string;
} {
  let target = rawTarget.normalize("NFKC").trim().replaceAll("\\", "/");
  if (target.startsWith("/") || target.split("/").includes("..")) {
    return { error: "target path escapes the vault or is not supported" };
  }
  while (target.startsWith("./")) {
    target = target.slice(2);
  }
  if (target.endsWith(".md")) {
    target = target.slice(0, -3);
  }
  if (!target) {
    return { error: "target note does not exist" };
  }
  const parts = target.split("/");
  if (parts.some((part) => !part || part === ".")) {
    return { error: "target path is not normalized" };
  }
  return { value: `${parts.join("/")}.md` };
}

function resolveTarget(
  manifest: Manifest,
  current: Note,
  rawTarget: string
): [Note | null, string | null] {
  if (!rawTarget) {
    return [current, null];
  }
  const normalized = normalizeTargetPath(rawTarget);
  if (normalized.error) {
    return [null, normalized.error];
  }
  const target = normalized.value as string;
  if (target.includes("/")) {
    const wanted = relativeKey(target);
    const matches = manifest.notes.filter(
      (note) => note.relativeKey === wanted
    );
    if (matches.length === 1) {
      return [matches[0], null];
    }
    if (matches.length > 1) {
      return [null, "ambiguous target path"];
    }
    return [null, "target note does not exist at the specified path"];
  }
  const wanted = filenameKey(path.basename(target, ".md"));
  const matches = manifest.notes.filter((note) => note.basenameKey === wanted);
  if (matches.length === 1) {
    return [matches[0], null];
  }
  if (matches.length > 1) {
    return [
      null,
      `ambiguous target (${matches.length} notes have this filename)`,
    ];
  }
  return [null, "target note does not exist"];
}

function checkFile(manifest: Manifest, suppliedFile: string): ErrorItem[] {
  const file = path.resolve(suppliedFile);
  if (!fs.existsSync(file)) {
    return [{ file, line: 0, message: "file does not exist" }];
  }
  const stat = fs.lstatSync(file);
  if (
    !inside(manifest.rootRealpath, file) ||
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    return [
      {
        file,
        line: 0,
        message:
          "file is not a regular Markdown note in the canonical manifest",
      },
    ];
  }
  const real = fs.realpathSync(file);
  const current = manifest.notes.find((note) => note.realpath === real);
  if (!current) {
    return [
      {
        file,
        line: 0,
        message:
          "file is not a regular Markdown note in the canonical manifest",
      },
    ];
  }

  const errors: ErrorItem[] = [...current.parseErrors];
  for (const [line, text] of current.visibleLines) {
    for (const match of text.matchAll(LINK_RE)) {
      const raw = match.groups?.raw ?? "";
      const body = raw.split("|", 1)[0].trim();
      const separator = body.indexOf("#");
      if (separator === -1 || separator === body.length - 1) {
        errors.push({
          file,
          line,
          message: `[[${raw}]]: bare wikilink; add an exact heading or block anchor`,
        });
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
        errors.push({
          file,
          line,
          message: `[[${raw}]]: target note has parse errors and cannot provide a deterministic anchor`,
        });
        continue;
      }

      if (anchor.startsWith("^")) {
        const blockId = anchor.slice(1);
        if (!LEGAL_BLOCK_ID_RE.test(blockId)) {
          errors.push({
            file,
            line,
            message: `[[${raw}]]: block ID must match [A-Za-z0-9_-]+`,
          });
          continue;
        }
        const matches = resolved.blockIds.filter(
          (block) => block.id === blockId
        );
        if (matches.length !== 1) {
          errors.push({
            file,
            line,
            message:
              matches.length === 0
                ? `[[${raw}]]: block anchor does not exist in the target note`
                : `[[${raw}]]: block anchor is duplicated in the target note`,
          });
        }
        continue;
      }

      const wantedHeading = key(anchor);
      const matches = resolved.headings.filter(
        (heading) => heading.key === wantedHeading
      );
      if (matches.length !== 1) {
        errors.push({
          file,
          line,
          message:
            matches.length === 0
              ? `[[${raw}]]: heading anchor does not exist in the target note`
              : `[[${raw}]]: heading anchor is duplicated in the target note`,
        });
      }
    }
  }
  return errors;
}

function summary(
  manifest: Manifest,
  requested: string[],
  errors: ErrorItem[] = []
): Evidence {
  const findings = [
    ...manifest.errors.map((message) =>
      finding("manifest-scan-incomplete", "error", message, {
        path: manifest.rootRealpath,
      })
    ),
    ...errors.map((item) =>
      finding("wikilink-invalid", "error", item.message, {
        line: item.line,
        path: item.file,
      })
    ),
  ];
  let gate: Evidence["gate"] = "unavailable";
  if (manifest.scanStatus === "complete") {
    gate = errors.length === 0 ? "passed" : "failed";
  }
  return evidence(
    "check-wikilinks",
    gate,
    { files: requested, vault_root: manifest.rootRealpath },
    {
      checked: requested.length,
      duplicate_keys: manifest.duplicateKeys,
      exclusions: manifest.exclusions,
      manifest_hash: manifest.manifestHash,
      note_count: manifest.notes.length,
      scan_status: manifest.scanStatus,
    },
    findings
  );
}

function printErrors(errors: ErrorItem[]): void {
  for (const error of errors) {
    console.error(`ERROR ${error.file}:${error.line}: ${error.message}`);
  }
}

type ParsedArgs = {
  help: boolean;
  includeSkillDir: boolean;
  json: boolean;
  requested: string[];
  vault: string;
};

function parseArgs(args: string[]): ParsedArgs {
  let vault = "";
  let json = false;
  let includeSkillDir = false;
  const requested: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === "--help" || argument === "-h") {
      return { help: true, includeSkillDir, json, requested, vault };
    }
    if (argument === "--json") {
      json = true;
    } else if (argument === "--include-skill-dir") {
      includeSkillDir = true;
    } else if (argument === "--vault-root") {
      i += 1;
      vault = args[i] ?? "";
      if (!vault || vault.startsWith("--")) {
        throw new Error("--vault-root requires a directory");
      }
    } else if (argument === "--file") {
      i += 1;
      const file = args[i] ?? "";
      if (!file || file.startsWith("--")) {
        throw new Error("--file requires a note path");
      }
      requested.push(file);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { help: false, includeSkillDir, json, requested, vault };
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(
      "usage: node scripts/check-wikilinks.ts --vault-root VAULT --file NOTE [--file NOTE ...] [--json]"
    );
    console.log("       node scripts/check-wikilinks.ts --self-test");
    return 0;
  }
  let { vault } = parsed;
  const { includeSkillDir, json, requested } = parsed;
  if (!vault || requested.length === 0) {
    throw new Error(
      "usage: node scripts/check-wikilinks.ts --vault-root VAULT --file NOTE"
    );
  }
  vault = path.resolve(vault);
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
    throw new Error(`vault root is not a directory: ${vault}`);
  }

  const manifest = scanManifest(vault, includeSkillDir);
  const errors: ErrorItem[] = [];
  for (const supplied of requested) {
    const file = path.resolve(supplied);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      errors.push({ file, line: 0, message: "file does not exist" });
    } else {
      errors.push(...checkFile(manifest, file));
    }
  }
  const result = summary(manifest, requested, errors);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  }
  if (manifest.errors.length > 0) {
    if (!json) {
      printErrors(
        manifest.errors.map((message) => ({ file: vault, line: 0, message }))
      );
    }
    return 2;
  }
  if (errors.length > 0) {
    if (!json) {
      printErrors(errors);
    }
    return 1;
  }
  if (!json) {
    console.log(
      `OK: checked ${requested.length} note(s); manifest=${manifest.manifestHash}; all wikilinks resolve to unique anchored positions`
    );
  }
  return exitForGate(result.gate);
}

function assertSelfTest(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`self-test failed: ${message}`);
  }
}

function runWikilinkCase(
  root: string,
  note: string,
  body: string
): ErrorItem[] {
  fs.writeFileSync(note, body, "utf-8");
  const currentManifest = scanManifest(root, true);
  return checkFile(currentManifest, note);
}

function selfTest(): number {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-distiller-wikilink-")
  );
  try {
    fs.mkdirSync(path.join(root, "one"));
    fs.mkdirSync(path.join(root, "two"));
    fs.mkdirSync(path.join(root, "generated"));
    fs.mkdirSync(path.join(root, ".agents"));
    fs.writeFileSync(
      path.join(root, "Target.md"),
      [
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
      ].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, "DuplicateHeading.md"),
      "# Same\n# Same\n",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, "DuplicateBlock.md"),
      "# Blocks\nfirst ^duplicate\nsecond ^duplicate\n",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, "one", "Duplicate.md"),
      "# Real Heading\n",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, "two", "Duplicate.md"),
      "# Real Heading\n",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, "generated", "Hidden.md"),
      "# Hidden\n",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, ".agents", "Excluded.md"),
      "# Excluded\n",
      "utf-8"
    );
    const symlink = path.join(root, "Alias.md");
    try {
      fs.symlinkSync("Target.md", symlink);
    } catch {
      /* symlinks may be unavailable; other cases remain meaningful */
    }

    const manifest = scanManifest(root, true);
    assertSelfTest(
      manifest.scanStatus === "complete",
      "fixture scan should be complete"
    );
    assertSelfTest(
      manifest.notes.every(
        (note) => !note.relativePath.startsWith("generated/")
      ),
      "generated notes must be excluded"
    );
    assertSelfTest(
      manifest.notes.every((note) => !note.relativePath.startsWith(".agents/")),
      "excluded directories must be absent"
    );
    assertSelfTest(
      manifest.duplicateKeys.includes("duplicate"),
      "duplicate basename must be recorded"
    );
    const target = manifest.notes.find(
      (note) => note.relativePath === "Target.md"
    );
    assertSelfTest(Boolean(target), "target note must be in the manifest");
    assertSelfTest(
      target?.headings.length === 1 &&
        target.headings[0].text === "Real Heading",
      "frontmatter/fence headings must be ignored"
    );
    assertSelfTest(
      target?.blockIds.length === 1 && target.blockIds[0].id === "block-1",
      "frontmatter/fence/inline block IDs must be ignored"
    );

    const note = path.join(root, "Note.md");
    assertSelfTest(
      runWikilinkCase(
        root,
        note,
        [
          "# Local",
          "[[Target#Real Heading|heading]]",
          "[[Target#^block-1|block]]",
          "[[#Local|local]]",
          "`[[Missing#Nope|inline code]]`",
          "```",
          "[[Missing#Nope|fenced code]]",
          "```",
        ].join("\n")
      ).length === 0,
      "valid links and code exclusions should pass"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[Target#Frontmatter Heading|bad]]").length >
        0,
      "frontmatter heading must not resolve"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[Target#Fenced Heading|bad]]").length > 0,
      "fenced heading must not resolve"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[Target#^fenced-block|bad]]").length > 0,
      "fenced block ID must not resolve"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[DuplicateHeading#Same|bad]]").some(
        (error) => error.message.includes("duplicated")
      ),
      "duplicate heading must fail"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[DuplicateBlock#^duplicate|bad]]").some(
        (error) => error.message.includes("duplicated")
      ),
      "duplicate block ID must fail"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[Duplicate#Real Heading|bad]]").some(
        (error) => error.message.includes("ambiguous")
      ),
      "duplicate basename must fail"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[one/Duplicate#Real Heading|qualified]]")
        .length === 0,
      "unique path-qualified target should pass"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[generated/Hidden#Hidden|excluded]]")
        .length > 0,
      "excluded target must not resolve"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[../Target#Real Heading|escape]]").length >
        0,
      "path traversal must fail"
    );
    assertSelfTest(
      runWikilinkCase(root, note, "[[Target#^bad.id|illegal block]]").length >
        0,
      "illegal block ID must fail"
    );
    if (fs.existsSync(symlink)) {
      assertSelfTest(
        runWikilinkCase(root, note, "[[Alias#Real Heading|symlink]]").length >
          0,
        "symlink target must be absent"
      );
    }

    const source = path.join(root, "one", "Source.md");
    fs.writeFileSync(source, "[[Duplicate#Real Heading|shortcut]]\n", "utf-8");
    const sourceManifest = scanManifest(root, true);
    assertSelfTest(
      checkFile(sourceManifest, source).some((error) =>
        error.message.includes("ambiguous")
      ),
      "current-directory shortcut must not bypass global ambiguity"
    );
    console.log("wikilink checker self-test: PASS");
    return 0;
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

function runCli(): number {
  if (process.argv.includes("--self-test")) {
    return selfTest();
  }
  return main();
}

try {
  process.exitCode = runCli();
} catch (error) {
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        evidence(
          "check-wikilinks",
          "unavailable",
          { args: process.argv.slice(2) },
          {},
          [
            finding(
              "checker-invocation-invalid",
              "error",
              (error as Error).message
            ),
          ]
        ),
        null,
        2
      )
    );
  } else {
    console.error(`ERROR: ${(error as Error).message}`);
  }
  process.exitCode = 2;
}
