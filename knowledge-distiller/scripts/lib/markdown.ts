import * as fs from "node:fs";

import { sha256 } from "./evidence.ts";

export type Heading = {
  line: number;
  level: number;
  text: string;
  key: string;
};
export type BlockId = { line: number; id: string };
export type Fence = {
  line: number;
  end_line?: number;
  marker: "`" | "~";
  length: number;
  info: string;
  language: string;
};
export type Callout = {
  line: number;
  type: string;
  fold: "open" | "closed" | "none";
  title: string;
  depth: number;
};
export type Table = { line: number; separator_line: number; columns: number };
export type Surface = {
  file: string;
  bytes: number;
  content_hash: string;
  lines: string[];
  body_lines: [number, string][];
  frontmatter: {
    present: boolean;
    closed: boolean;
    start_line?: number;
    end_line?: number;
  };
  headings: Heading[];
  block_ids: BlockId[];
  fences: Fence[];
  callouts: Callout[];
  tables: Table[];
  wikilinks: { line: number; raw: string }[];
  external_links: { line: number; raw: string; text?: string }[];
  footnotes: { line: number; raw: string }[];
  emphasis: {
    line: number;
    syntax: "bold" | "italic" | "highlight" | "strike";
    raw: string;
  }[];
  mermaid_blocks: { line: number; end_line?: number; body: string }[];
  parse_errors: { code: string; line: number; message: string }[];
};

export const CALLOUT_TYPES: Record<string, string[]> = {
  abstract: ["summary", "tldr"],
  bug: [],
  danger: ["error"],
  example: [],
  failure: ["fail", "missing"],
  info: [],
  note: [],
  question: ["help", "faq"],
  quote: ["cite"],
  success: ["check", "done"],
  tip: ["hint", "important"],
  todo: [],
  warning: ["caution", "attention"],
};

export const CALLOUT_ALIASES = new Map<string, string>(
  Object.entries(CALLOUT_TYPES).flatMap(([type, aliases]) => [
    [type, type] as [string, string],
    ...aliases.map((alias): [string, string] => [alias, type]),
  ])
);

export const SUPPORTED_MERMAID_TYPES = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "timeline",
] as const;

export const SUPPORTED_MERMAID_TYPE_SET = new Set<string>(
  SUPPORTED_MERMAID_TYPES
);

export function normalize(value: string): string {
  return value
    .trim()
    .replaceAll(/\s+/gu, " ")
    .replace(/\s+#+\s*$/u, "");
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
      while (index + run < line.length && line[index + run] === "`") {
        run += 1;
      }
      for (let offset = 0; offset < run; offset += 1) {
        output[index + offset] = " ";
      }
      if (runLength === 0) {
        runLength = run;
      } else if (run === runLength) {
        runLength = 0;
      }
      index += run;
      continue;
    }
    if (runLength > 0) {
      output[index] = " ";
    }
    index += 1;
  }
  return output.join("");
}

function strippedQuotePrefix(line: string): { value: string; depth: number } {
  let value = line;
  let depth = 0;
  while (true) {
    const match = value.match(/^\s*>\s?/u);
    if (!match) {
      break;
    }
    value = value.slice(match[0].length);
    depth += 1;
  }
  return { depth, value };
}

function tableColumnCount(line: string): number {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split("|").length;
}

function collectEmphasis(
  lineNumber: number,
  line: string
): Surface["emphasis"] {
  const masked = maskInlineCode(line);
  const result: Surface["emphasis"] = [];
  const patterns: [RegExp, Surface["emphasis"][number]["syntax"]][] = [
    [/\*\*[^*\n]+\*\*/gu, "bold"],
    [/__[^_\n]+__/gu, "bold"],
    [/[=]=[^=\n]+==/gu, "highlight"],
    [/~~[^~\n]+~~/gu, "strike"],
    [/(?<!\*)\*[^*\n]+\*(?!\*)/gu, "italic"],
    [/(?<!_)_[^_\n]+_(?!_)/gu, "italic"],
  ];
  for (const [pattern, syntax] of patterns) {
    for (const match of masked.matchAll(pattern)) {
      result.push({ line: lineNumber, raw: match[0], syntax });
    }
  }
  return result;
}

type ParseState = {
  bodyLines: Surface["body_lines"];
  blockIds: BlockId[];
  callouts: Callout[];
  currentMermaid?: { line: number; body: string[] };
  emphasis: Surface["emphasis"];
  externalLinks: Surface["external_links"];
  fences: Fence[];
  footnotes: Surface["footnotes"];
  frontmatter: Surface["frontmatter"];
  headings: Heading[];
  inFrontmatter: boolean;
  mermaidBlocks: Surface["mermaid_blocks"];
  openFence?: Fence;
  parseErrors: Surface["parse_errors"];
  tableCandidate?: { line: number; columns: number };
  tables: Table[];
  wikilinks: Surface["wikilinks"];
};

function handleFence(
  lineNumber: number,
  syntaxLine: string,
  state: ParseState
): boolean {
  const match = syntaxLine.match(/^\s*(?<marker>`{3,}|~{3,})(?<info>.*)$/u);
  if (match) {
    const { groups } = match;
    if (!groups) {
      return true;
    }
    const marker = groups.marker[0] as "`" | "~";
    const { length } = groups.marker;
    if (!state.openFence) {
      const info = groups.info.trim();
      const language = (info.split(/\s+/u)[0] ?? "").toLowerCase();
      state.openFence = { info, language, length, line: lineNumber, marker };
      state.fences.push(state.openFence);
      if (language === "mermaid") {
        state.currentMermaid = { body: [], line: lineNumber };
      }
    } else if (
      marker === state.openFence.marker &&
      length >= state.openFence.length
    ) {
      state.openFence.end_line = lineNumber;
      if (state.currentMermaid) {
        state.mermaidBlocks.push({
          body: state.currentMermaid.body.join("\n"),
          end_line: lineNumber,
          line: state.currentMermaid.line,
        });
        state.currentMermaid = undefined;
      }
      state.openFence = undefined;
    }
    return true;
  }
  if (state.openFence) {
    if (state.currentMermaid) {
      state.currentMermaid.body.push(syntaxLine);
    }
    return true;
  }
  return false;
}

function collectTable(
  lineNumber: number,
  visible: string,
  nextLine: string,
  state: ParseState
): void {
  const separator = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/u;
  if (!/^\s*\|?.+\|.+\|?\s*$/u.test(visible)) {
    return;
  }
  if (state.tableCandidate && separator.test(visible)) {
    const columns = tableColumnCount(visible);
    if (columns !== state.tableCandidate.columns) {
      state.parseErrors.push({
        code: "table-column-mismatch",
        line: lineNumber,
        message: "table header and separator have different column counts",
      });
    }
    state.tables.push({
      columns,
      line: state.tableCandidate.line,
      separator_line: lineNumber,
    });
    state.tableCandidate = undefined;
  } else if (!state.tableCandidate && separator.test(nextLine)) {
    state.tableCandidate = {
      columns: tableColumnCount(visible),
      line: lineNumber,
    };
  }
}

function collectCallout(
  lineNumber: number,
  line: string,
  quoteDepth: number,
  state: ParseState
): void {
  const callout = line.match(
    /^\s*(?<prefix>(?:>\s*)+)\[!(?<type>[A-Za-z0-9_-]+)\](?<fold>[+-]?)(?:[ \t]+(?<title>.*?))?\s*$/u
  );
  if (!callout?.groups) {
    return;
  }
  const { fold, prefix, title, type } = callout.groups;
  let calloutFold: Callout["fold"] = "none";
  if (fold === "+") {
    calloutFold = "open";
  } else if (fold === "-") {
    calloutFold = "closed";
  }
  state.callouts.push({
    depth: Math.max(0, (prefix.match(/>/gu)?.length ?? quoteDepth) - 1),
    fold: calloutFold,
    line: lineNumber,
    title: (title ?? "").trim(),
    type: type.toLowerCase(),
  });
}

function collectLinks(
  lineNumber: number,
  visible: string,
  state: ParseState
): void {
  for (const match of visible.matchAll(/\[\[(?<raw>[^\]\n]+)\]\]/gu)) {
    if (match.groups?.raw) {
      state.wikilinks.push({ line: lineNumber, raw: match.groups.raw });
    }
  }
  for (const match of visible.matchAll(
    /\[(?<text>[^\]\n]*)\]\((?<url>https?:\/\/[^\s)\]>]+)\)|(?<bare>https?:\/\/[^\s)\]>]+)/gu
  )) {
    const raw = match.groups?.url ?? match.groups?.bare ?? "";
    if (!raw) {
      continue;
    }
    const text = match.groups?.text;
    state.externalLinks.push({
      line: lineNumber,
      raw,
      ...(text ? { text } : {}),
    });
  }
  for (const match of visible.matchAll(/\[\^[^\]\n]+\]/gu)) {
    state.footnotes.push({ line: lineNumber, raw: match[0] });
  }
  state.emphasis.push(...collectEmphasis(lineNumber, visible));
}

function collectBodyLine(
  lineNumber: number,
  line: string,
  quoteDepth: number,
  nextLine: string,
  state: ParseState
): void {
  state.bodyLines.push([lineNumber, line]);
  const visible = maskInlineCode(line);
  const heading = visible.match(/^\s*(?<hashes>#{1,6})[ \t]+(?<text>.+?)\s*$/u);
  if (heading?.groups) {
    const { hashes, text } = heading.groups;
    state.headings.push({
      key: key(text),
      level: hashes.length,
      line: lineNumber,
      text: normalize(text),
    });
  } else {
    const blockId = visible.match(/(?:^|[ \t])\^(?<id>[A-Za-z0-9_-]+)[ \t]*$/u);
    if (blockId?.groups?.id) {
      state.blockIds.push({ id: blockId.groups.id, line: lineNumber });
    }
  }

  collectCallout(lineNumber, line, quoteDepth, state);
  collectTable(lineNumber, visible, nextLine, state);
  collectLinks(lineNumber, visible, state);
}

function processLine(
  rawLine: string,
  index: number,
  lines: string[],
  state: ParseState
): void {
  const lineNumber = index + 1;
  const quote = strippedQuotePrefix(rawLine);
  const syntaxLine = quote.value;
  if (state.inFrontmatter) {
    if (
      lineNumber > 1 &&
      (rawLine.trim() === "---" || rawLine.trim() === "...")
    ) {
      state.inFrontmatter = false;
      state.frontmatter.closed = true;
      state.frontmatter.end_line = lineNumber;
    }
    return;
  }
  if (handleFence(lineNumber, syntaxLine, state)) {
    return;
  }
  if (lineNumber === 1 && rawLine.trim() === "---") {
    return;
  }
  collectBodyLine(
    lineNumber,
    rawLine,
    quote.depth,
    lines[index + 1] ?? "",
    state
  );
}

export function parseMarkdown(file: string): Surface {
  const bytes = fs.readFileSync(file);
  const text = bytes.toString("utf-8").replace(/^\uFEFF/u, "");
  const lines = text.split(/\r?\n/u);
  const inFrontmatter = lines[0]?.trim() === "---";
  const state: ParseState = {
    blockIds: [],
    bodyLines: [],
    callouts: [],
    emphasis: [],
    externalLinks: [],
    fences: [],
    footnotes: [],
    frontmatter: {
      closed: !inFrontmatter,
      present: inFrontmatter,
      ...(inFrontmatter ? { start_line: 1 } : {}),
    },
    headings: [],
    inFrontmatter,
    mermaidBlocks: [],
    parseErrors: [],
    tables: [],
    wikilinks: [],
  };
  for (const [index, rawLine] of lines.entries()) {
    processLine(rawLine, index, lines, state);
  }

  if (!state.frontmatter.closed) {
    state.parseErrors.push({
      code: "frontmatter-unclosed",
      line: 1,
      message: "YAML frontmatter is not closed",
    });
  }
  if (state.openFence) {
    state.parseErrors.push({
      code: "fence-unclosed",
      line: state.openFence.line,
      message: "fenced code block is not closed",
    });
    if (state.currentMermaid) {
      state.mermaidBlocks.push({
        body: state.currentMermaid.body.join("\n"),
        line: state.currentMermaid.line,
      });
    }
  }
  if (state.tableCandidate) {
    state.parseErrors.push({
      code: "table-separator-missing",
      line: state.tableCandidate.line,
      message: "table header has no valid separator row",
    });
  }

  return {
    block_ids: state.blockIds,
    body_lines: state.bodyLines,
    bytes: bytes.byteLength,
    callouts: state.callouts,
    content_hash: sha256(bytes),
    emphasis: state.emphasis,
    external_links: state.externalLinks,
    fences: state.fences,
    file,
    footnotes: state.footnotes,
    frontmatter: state.frontmatter,
    headings: state.headings,
    lines,
    mermaid_blocks: state.mermaidBlocks,
    parse_errors: state.parseErrors,
    tables: state.tables,
    wikilinks: state.wikilinks,
  };
}

export function frontmatterTitle(surface: Surface): string | undefined {
  if (!surface.frontmatter.present || !surface.frontmatter.closed) {
    return undefined;
  }
  const end = surface.frontmatter.end_line ?? 0;
  for (let i = 1; i < end - 1; i += 1) {
    const match = surface.lines[i].match(
      /^title:\s*["']?(?<title>.*?)["']?\s*$/u
    );
    if (match) {
      return normalize(match.groups?.title ?? "");
    }
  }
  return undefined;
}

export function canonicalCalloutType(type: string): string | undefined {
  return CALLOUT_ALIASES.get(type.toLowerCase());
}
