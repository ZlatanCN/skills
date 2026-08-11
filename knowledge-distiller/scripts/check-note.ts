#!/usr/bin/env node
// One public aggregate for the final note. Focused checkers remain diagnostics.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";

import {
  evidence,
  exitForGate,
  fileHash,
  finding,
  isRecord,
  runMain,
  withTempDir,
} from "./lib/evidence.ts";
import type { Evidence, Finding } from "./lib/evidence.ts";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
// ponytail: keep focused diagnostics as child processes; inline them only if checker startup dominates real runs.

type Args = {
  file: string;
  vault: string;
  original: string;
  preservation: string;
  json: boolean;
  strict: boolean;
  portable: boolean;
};

function parseArgs(args: string[]): Args {
  const result: Args = {
    file: "",
    json: args.includes("--json"),
    original: "",
    portable: true,
    preservation: "",
    strict: true,
    vault: "",
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--file") {
      result.file = args[(i += 1)] ?? "";
    } else if (arg === "--vault-root") {
      result.vault = args[(i += 1)] ?? "";
    } else if (arg === "--original") {
      result.original = args[(i += 1)] ?? "";
    } else if (arg === "--preservation") {
      result.preservation = args[(i += 1)] ?? "";
    } else if (arg === "--no-strict") {
      result.strict = false;
    } else if (arg === "--no-portable") {
      result.portable = false;
    } else if (!["--json", "--help", "-h"].includes(arg)) {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return result;
}

function child(script: string, args: string[]): Evidence {
  const result = spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, script), ...args, "--json"],
    { encoding: "utf-8" }
  );
  try {
    const parsed = JSON.parse(result.stdout ?? "") as Evidence;
    if (
      !isRecord(parsed) ||
      !new Set(["passed", "failed", "unavailable"]).has(String(parsed.gate)) ||
      !Array.isArray(parsed.findings)
    ) {
      throw new Error("malformed evidence envelope");
    }
    if (result.status !== exitForGate(parsed.gate as Evidence["gate"])) {
      throw new Error("child exit code contradicts its evidence gate");
    }
    return parsed;
  } catch (error) {
    return evidence("check-note", "unavailable", { args, script }, {}, [
      finding(
        "child-checker-invalid",
        "error",
        `${script} did not return a valid evidence envelope: ${(error as Error).message}`,
        {
          evidence: {
            stderr: result.stderr ?? "",
            stdout: result.stdout ?? "",
          },
        }
      ),
    ]);
  }
}

function inputFindings(args: Args): Finding[] {
  const findings: Finding[] = [];
  const file = path.resolve(args.file);
  const vault = path.resolve(args.vault);
  if (!args.file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    findings.push(
      finding("note-missing", "error", "note file does not exist", {
        path: file,
      })
    );
  }
  if (
    !args.vault ||
    !fs.existsSync(vault) ||
    !fs.statSync(vault).isDirectory()
  ) {
    findings.push(
      finding("vault-root-unavailable", "error", "vault root does not exist", {
        path: vault,
      })
    );
  }
  if (Boolean(args.original) !== Boolean(args.preservation)) {
    findings.push(
      finding(
        "preservation-pair-incomplete",
        "error",
        "--original and --preservation must be supplied together"
      )
    );
  }
  return findings;
}

function check(args: Args): Evidence {
  const file = path.resolve(args.file);
  const before =
    fs.existsSync(file) && fs.statSync(file).isFile()
      ? fileHash(file)
      : undefined;
  const findings = inputFindings(args);
  const checks: Record<string, Evidence> = {};
  if (findings.length === 0) {
    checks.surface = child("check-note-surface.ts", [
      "--file",
      file,
      ...(args.strict ? ["--strict"] : []),
      ...(args.portable ? ["--portable"] : []),
    ]);
    checks.heading = child("check-heading-tree.ts", [
      "--file",
      file,
      "--strict",
    ]);
    checks.wikilinks = child("check-wikilinks.ts", [
      "--vault-root",
      path.resolve(args.vault),
      "--file",
      file,
    ]);
    if (args.original && args.preservation) {
      checks.preservation = child("check-preservation.ts", [
        "--record",
        path.resolve(args.preservation),
        "--original",
        path.resolve(args.original),
        "--draft",
        file,
      ]);
    }
  }
  const after =
    fs.existsSync(file) && fs.statSync(file).isFile()
      ? fileHash(file)
      : undefined;
  if (before !== after) {
    findings.push(
      finding(
        "note-mutated-during-check",
        "error",
        "note bytes changed while checks were running",
        {
          evidence: { after, before },
          path: file,
        }
      )
    );
  }
  for (const [name, result] of Object.entries(checks)) {
    findings.push(
      ...result.findings.map((item) => ({
        ...item,
        evidence: { ...item.evidence, checker: name },
      }))
    );
  }
  const values = Object.values(checks);
  let gate: Evidence["gate"] = "passed";
  if (
    findings.some((item) => item.severity === "error") ||
    values.some((item) => item.gate === "failed")
  ) {
    gate = "failed";
  } else if (values.some((item) => item.gate === "unavailable")) {
    gate = "unavailable";
  }
  return evidence(
    "check-note",
    gate,
    {
      file,
      original: args.original ? path.resolve(args.original) : undefined,
      preservation: args.preservation
        ? path.resolve(args.preservation)
        : undefined,
      sha256: after,
      vault_root: path.resolve(args.vault),
    },
    {
      checker_count: values.length,
      passed: values.filter((item) => item.gate === "passed").length,
    },
    findings,
    checks
  );
}

function selfTest(): number {
  return withTempDir("knowledge-distiller-note-", (root) => {
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    const note = path.join(vault, "Note.md");
    fs.writeFileSync(note, "# Note\n\n正文。\n", "utf-8");
    if (
      check({
        file: note,
        json: false,
        original: "",
        portable: true,
        preservation: "",
        strict: true,
        vault,
      }).gate !== "passed"
    ) {
      throw new Error("valid aggregate should pass");
    }
    console.log("note gate self-test: PASS");
    return 0;
  });
}

function main(): number {
  const raw = process.argv.slice(2);
  if (raw.includes("--self-test")) {
    return selfTest();
  }
  if (raw.includes("--help") || raw.includes("-h")) {
    console.log(
      "usage: node scripts/check-note.ts --file NOTE --vault-root VAULT [--original ORIGINAL --preservation RECORD] [--json]"
    );
    return 0;
  }
  const args = parseArgs(raw);
  if (!args.file || !args.vault) {
    throw new Error("--file and --vault-root are required");
  }
  const result = check(args);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      result.gate === "passed"
        ? "OK: note checks passed"
        : `NOTE CHECK ${result.gate}`
    );
  }
  return exitForGate(result.gate);
}

runMain(main);
