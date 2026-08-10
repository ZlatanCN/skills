import * as fs from "node:fs";
import { fileHash } from "./evidence.ts";

export type Heading = { line: number; level: number; text: string; key: string };
export type BlockId = { line: number; id: string };
export type Fence = { line: number; end_line?: number; marker: "`" | "~"; length: number; info: string; language: string };
export type Callout = { line: number; type: string; fold: "open" | "closed" | "none"; title: string; depth: number };
export type Table = { line: number; separator_line: number; columns: number };
export type Surface = {
  file: string;
  bytes: number;
  content_hash: string;
  lines: string[];
  body_lines: Array<[number, string]>;
  frontmatter: { present: boolean; closed: boolean; start_line?: number; end_line?: number };
  headings: Heading[];
  block_ids: BlockId[];
  fences: Fence[];
  callouts: Callout[];
  tables: Table[];
  wikilinks: Array<{ line: number; raw: string }>;
  external_links: Array<{ line: number; raw: string }>;
  footnotes: Array<{ line: number; raw: string }>;
  emphasis: Array<{ line: number; syntax: "bold" | "italic" | "highlight" | "strike"; raw: string }>;
  mermaid_blocks: Array<{ line: number; end_line?: number; body: string }>;
  parse_errors: Array<{ code: string; line: number; message: string }>;
};

export const CALLOUT_TYPES: Record<string, string[]> = {
  note: [],
  abstract: ["summary", "tldr"],
  info: [],
  todo: [],
  tip: ["hint", "important"],
  success: ["check", "done"],
  question: ["help", "faq"],
  warning: ["caution", "attention"],
  failure: ["fail", "missing"],
  danger: ["error"],
  bug: [],
  example: [],
  quote: ["cite"],
};

export const CALLOUT_ALIASES = new Map(
  Object.entries(CALLOUT_TYPES).flatMap(([type, aliases]) => [[type, type], ...aliases.map((alias) => [alias, type])]),
);

export function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\s+#+\s*$/, "");
}

export function key(value: string): string {
  return normalize(value).normalize("NFKC");
}

export function maskInlineCode(line: string): string {
  const output = [...line];
  let runLength = 0;
  let index = 0;
  while (index < line.length) {
    if (line[index] === "`" && (index === 0 || line[index - 1] !== "\\")) {
      let run = 1;
      while (index + run < line.length && line[index + run] === "`") run += 1;
      for (let offset = 0; offset < run; offset += 1) output[index + offset] = " ";
      if (runLength === 0) runLength = run;
      else if (run === runLength) runLength = 0;
      index += run;
      continue;
    }
    if (runLength > 0) output[index] = " ";
    index += 1;
  }
  return output.join("");
}

function strippedQuotePrefix(line: string): { value: string; depth: number } {
  let value = line;
  let depth = 0;
  while (true) {
    const match = value.match(/^\s*>\s?/);
    if (!match) break;
    value = value.slice(match[0].length);
    depth += 1;
  }
  return { value, depth };
}

function tableColumnCount(line: string): number {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").length;
}

function collectEmphasis(lineNumber: number, line: string): Surface["emphasis"] {
  const masked = maskInlineCode(line);
  const result: Surface["emphasis"] = [];
  const patterns: Array<[RegExp, Surface["emphasis"][number]["syntax"]]> = [
    [/\*\*[^*\n]+\*\*/g, "bold"],
    [/__[^_\n]+__/g, "bold"],
    [/==[^=\n]+==/g, "highlight"],
    [/~~[^~\n]+~~/g, "strike"],
    [/(?<!\*)\*[^*\n]+\*(?!\*)/g, "italic"],
    [/(?<!_)_[^_\n]+_(?!_)/g, "italic"],
  ];
  for (const [pattern, syntax] of patterns) {
    for (const match of masked.matchAll(pattern)) {
      result.push({ line: lineNumber, syntax, raw: match[0] });
    }
  }
  return result;
}

export function parseMarkdown(file: string): Surface {
  const bytes = fs.readFileSync(file);
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const bodyLines: Surface["body_lines"] = [];
  const headings: Heading[] = [];
  const blockIds: BlockId[] = [];
  const fences: Fence[] = [];
  const callouts: Callout[] = [];
  const tables: Table[] = [];
  const wikilinks: Surface["wikilinks"] = [];
  const externalLinks: Surface["external_links"] = [];
  const footnotes: Surface["footnotes"] = [];
  const emphasis: Surface["emphasis"] = [];
  const mermaidBlocks: Surface["mermaid_blocks"] = [];
  const parseErrors: Surface["parse_errors"] = [];

  let inFrontmatter = lines[0]?.trim() === "---";
  const frontmatter = { present: inFrontmatter, closed: !inFrontmatter } as Surface["frontmatter"];
  if (inFrontmatter) frontmatter.start_line = 1;
  let openFence: Fence | undefined;
  let tableCandidate: { line: number; columns: number } | undefined;
  let currentMermaid: { line: number; body: string[] } | undefined;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine;
    const quote = strippedQuotePrefix(line);
    const syntaxLine = quote.value;

    if (inFrontmatter) {
      if (lineNumber > 1 && (line.trim() === "---" || line.trim() === "...")) {
        inFrontmatter = false;
        frontmatter.closed = true;
        frontmatter.end_line = lineNumber;
      }
      return;
    }

    const fenceMatch = syntaxLine.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      const length = fenceMatch[1].length;
      if (!openFence) {
        const info = fenceMatch[2].trim();
        const language = (info.split(/\s+/)[0] ?? "").toLowerCase();
        openFence = { line: lineNumber, marker, length, info, language };
        fences.push(openFence);
        if (language === "mermaid") currentMermaid = { line: lineNumber, body: [] };
      } else if (marker === openFence.marker && length >= openFence.length) {
        openFence.end_line = lineNumber;
        if (currentMermaid) {
          mermaidBlocks.push({ line: currentMermaid.line, end_line: lineNumber, body: currentMermaid.body.join("\n") });
          currentMermaid = undefined;
        }
        openFence = undefined;
      }
      return;
    }
    if (openFence) {
      if (currentMermaid) currentMermaid.body.push(syntaxLine);
      return;
    }

    if (lineNumber === 1 && line.trim() === "---") return;
    bodyLines.push([lineNumber, line]);
    const visible = maskInlineCode(syntaxLine);
    const heading = visible.match(/^\s*(#{1,6})[ \t]+(.+?)\s*$/);
    if (heading) headings.push({ line: lineNumber, level: heading[1].length, text: normalize(heading[2]), key: key(heading[2]) });
    else {
      const blockId = visible.match(/(?:^|[ \t])\^([A-Za-z0-9_-]+)[ \t]*$/);
      if (blockId) blockIds.push({ line: lineNumber, id: blockId[1] });
    }

    const callout = line.match(/^\s*((?:>\s*)+)\[!([A-Za-z0-9_-]+)\]([+-]?)(?:[ \t]+(.*?))?\s*$/);
    if (callout) {
      const rawType = callout[2].toLowerCase();
      callouts.push({
        line: lineNumber,
        type: rawType,
        fold: callout[3] === "+" ? "open" : callout[3] === "-" ? "closed" : "none",
        title: (callout[4] ?? "").trim(),
        depth: Math.max(0, (callout[1].match(/>/g)?.length ?? quote.depth) - 1),
      });
    }

    if (/^\s*\|?.+\|.+\|?\s*$/.test(visible)) {
      if (tableCandidate && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(visible)) {
        const columns = tableColumnCount(visible);
        if (columns !== tableCandidate.columns) {
          parseErrors.push({ code: "table-column-mismatch", line: lineNumber, message: "table header and separator have different column counts" });
        }
        tables.push({ line: tableCandidate.line, separator_line: lineNumber, columns });
        tableCandidate = undefined;
      } else if (!tableCandidate && lineNumber < lines.length && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(lines[index + 1] ?? "")) {
        tableCandidate = { line: lineNumber, columns: tableColumnCount(visible) };
      }
    }

    for (const match of visible.matchAll(/\[\[([^\]\n]+)\]\]/g)) wikilinks.push({ line: lineNumber, raw: match[1] });
    for (const match of visible.matchAll(/https?:\/\/[^\s)\]>]+/g)) externalLinks.push({ line: lineNumber, raw: match[0] });
    for (const match of visible.matchAll(/\[\^[^\]\n]+\]/g)) footnotes.push({ line: lineNumber, raw: match[0] });
    emphasis.push(...collectEmphasis(lineNumber, visible));
  });

  if (!frontmatter.closed) parseErrors.push({ code: "frontmatter-unclosed", line: 1, message: "YAML frontmatter is not closed" });
  if (openFence) {
    parseErrors.push({ code: "fence-unclosed", line: openFence.line, message: "fenced code block is not closed" });
    if (currentMermaid) mermaidBlocks.push({ line: currentMermaid.line, body: currentMermaid.body.join("\n") });
  }
  if (tableCandidate) parseErrors.push({ code: "table-separator-missing", line: tableCandidate.line, message: "table header has no valid separator row" });

  return {
    file,
    bytes: bytes.byteLength,
    content_hash: fileHash(file),
    lines,
    body_lines: bodyLines,
    frontmatter,
    headings,
    block_ids: blockIds,
    fences,
    callouts,
    tables,
    wikilinks,
    external_links: externalLinks,
    footnotes,
    emphasis,
    mermaid_blocks: mermaidBlocks,
    parse_errors: parseErrors,
  };
}

export function frontmatterTitle(surface: Surface): string | undefined {
  if (!surface.frontmatter.present || !surface.frontmatter.closed) return undefined;
  const end = surface.frontmatter.end_line ?? 0;
  for (let i = 1; i < end - 1; i += 1) {
    const match = surface.lines[i].match(/^title:\s*["']?(.*?)["']?\s*$/);
    if (match) return normalize(match[1]);
  }
  return undefined;
}

export function canonicalCalloutType(type: string): string | undefined {
  return CALLOUT_ALIASES.get(type.toLowerCase());
}
