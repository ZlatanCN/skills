---
name: knowledge-distiller
version: "0.6.1"
description: >
  Turn a user's rough technical understanding, research fragments, or existing technical note into a durable Chinese
  Obsidian note or a read-only structural/accuracy review. Use whenever the user asks to distill, fact-check, causally
  restructure, audit a teaching spine or heading tree, repair sibling inflation, or connect a technical note to a vault,
  even without naming this skill. By default write the note to Obsidian and always run independent clarity and accuracy
  review. Do not use for a plain factual question, simple polishing, or general vault operations.
---

# Knowledge Distiller

Write one standalone Chinese Obsidian note for a future reader. The default path is one path:

```text
reader contract → vault target → evidence → causal draft → safe write → clarity + accuracy review → report
```

If review finds actionable problems, make one integrated revision, write it safely, read it back, and review the new
exact bytes. Do not create a second workflow for “strict” or “quick” work.

## Non-negotiable contract

- Default to writing the note into the resolved Obsidian vault.
- Always run two independent read-only reviews: `clarity` and `accuracy`.
- Never write an unsupported material claim, guessed link, unsafe path, or unverified replacement.
- Keep the user's raw wording in reasoning only. The body contains the adjudicated domain claim, not the conversation.
- A failed or uncertain write is never reported as success.
- An explicit user request not to write overrides the default write, but it is an early return, not a second mode.

## 1. Route and reader contract

First decide whether the input contains understanding to distill or an existing technical note to audit.

- Plain factual question with no supplied reasoning: answer it and stop.
- Distillable technical understanding: continue through the full path below.
- An explicit request to inspect an existing note, teaching path, or heading tree: read it exactly and enter the same
  clarity/accuracy path without writing unless the user separately authorizes a revision.
- Unrelated topics, ambiguous output, or unresolved safety choice: ask one concise question and stop.

Before research, record in memory:

```text
reader  → who the note is for and what they already know
question → the one question the note answers
after   → the one explanation, prediction, or choice the reader must be able to teach back
scope   → included questions and intentionally excluded branches
spine   → problem → mechanism → consequence → decision or boundary
heading_convention → implicit filename title only
```

The after-state is a learning target, not a topic inventory. State the note's core judgment in one memorable sentence, then
name the concrete problem that makes it necessary. If the after-state cannot be taught back as problem → mechanism → concrete
example → choice, narrow or split the request before researching. A shared topic is not enough to justify one note.

Before research, separate the supplied material into observed phenomena, design problems, proposed models, and factual
claims. Preserve each item's epistemic role—user-provided, tentative, source-backed, or disputed—in reasoning without
copying the raw wording into the note. A user-proposed taxonomy remains a hypothesis until research adjudicates it.

Read `references/reader-model.md` before building the argument. If the input cannot share one spine, narrow it or split
the request; do not make a catalog of related technologies. Do not let a complete control inventory, source inventory, or
architecture inventory substitute for the one teaching path.

## 2. Resolve the vault and target

Resolve one absolute vault root from an explicit user path or the environment's known workspace root. Scan Markdown
files and filenames under that root, excluding `.git`, `.obsidian`, `.agents`, `.codex`, `node_modules`, build output,
generated output, artifacts, and this skill's implementation directory.

For the target:

1. Resolve the requested path against the vault root.
2. Reject `..`, absolute escapes, and symlink escapes.
3. If an existing same-topic note is the only candidate, update it in place.
4. If several candidates match, ask which one; never guess.
5. For a new note, confirm the target does not already exist.

If the vault root, target, collision choice, or containment check is unresolved, do not write. Report the exact blocker.

### Links

Use at most five central cross-note links. Emit only a link copied from the actual vault:

```text
[[Note#Exact Heading|概念别名]]
[[folder/Note#^unique-block-id|概念别名]]
```

The target file and anchor must each be unique and the target passage must define or materially explain the alias. A
mechanically valid but semantically adjacent link is omitted. Read `references/wikilinks.md` when links are needed.

For external-link placement, read `references/obsidian-writing-style.md`; clarity review owns the semantic decision.

## 3. Research and claims

Research new or materially changed technical notes. Start with 2–4 focused queries and use standards, specifications,
primary research, official documentation, and release notes before secondary writing.

Keep a small claim ledger in memory:

```text
claim   → the reader-facing domain claim
source  → exact URL/document section or local evidence
scope   → version, conditions, and boundary
limits  → what the evidence does not establish
decision → include | qualify | correct | defer | drop
role    → premise | mechanism | example | boundary | decision
status  → user hypothesis | working model | source-backed claim | disputed
```

Every material body claim needs a ledger entry. If evidence is partial, qualify it; if the central causal model is
unsupported, do not write it as fact. Do not use a search snippet, remembered fact, or one source to prove unrelated
claims. Treat a complete source list as input, not output: retain an item only when it advances the single teach-back and
changes the reader's current decision; group, exemplify, defer, or drop the rest. Evidence is not a retention license.

For a user-proposed classification, research its status before presenting it: confirm a source-backed taxonomy, retain it
as an explicitly labelled working model, split mixed axes, or correct/drop it when the evidence does not support it. Check
the classification's axis, abstraction level, scope, overlap, and claimed coverage; “not a protocol standard” is a boundary,
not evidence that the classification is valid.

When correcting the user's understanding, write the supported domain claim directly. Do not write a reply to an unseen
claim such as `“X”不准确`, `不是 X 而是 Y`, or `把 X 说成 Y`. A contrast is allowed only when the note introduces both
sides and the comparison has a reader-facing purpose. Treat the user's conversational premise as unavailable to the future
reader: if a correction, limitation, or causal conclusion depends on it, introduce the needed premise locally, rewrite the
sentence as a self-contained domain boundary, or drop it. Preserve the boundary when omitting it would cause a wrong decision;
do not preserve its conversational rebuttal shell just because the user stated it.

## 4. Compose the note

Build a teaching tree before prose, not a flat section list:

```text
section   → question it resolves
answer    → smallest answer that moves the reader forward
needs     → prerequisites
role      → premise | mechanism | example | boundary | decision
relation  → causal | prerequisite | parallel | composable | alternative | refinement
parent    → the larger question this section belongs to, or — for a top-level section
children  → contained subquestions, or —
next      → the question or decision this section unlocks
surface   → H1 | H2 | H3 | paragraph | list | table | callout
```

The filename is always the document title. If frontmatter has a `title`, it must match the filename; metadata must not
create a second title identity. Do not add a duplicate body title H1. Genuine top-level questions are H1 siblings; use
H2/H3 when a section is contained by, refines, explains,
limits, or helps decide the parent question. Heading depth expresses scope and dependency, never importance. A mechanism,
consequence, example, or boundary is not automatically a child: nest it only when the parent question actually contains it.
Use a paragraph, list, table, or callout when a heading would add no independent navigation value.

Before writing, run the sibling test: do the proposed siblings share one parent question; can each stand alone without the
preceding section; does the parent genuinely summarize all children; and would removing the heading lose navigation rather
than only visual emphasis? If any answer is unclear, redraw the tree. Never invent a parent merely to avoid an all-H1 note,
and never keep unrelated chapters flat merely because H1 siblings are mechanically legal.

Open with the core judgment and concrete problem. Then teach one causal path: why the problem occurs, how the mechanism
changes it, what the reader can observe in one small example, and which choice follows. Keep one main job per paragraph. Do not
compress different classification axes, predicates, or paragraph roles into one comma-separated list. For a necessary
enumeration, state its shared axis or action and return to the current decision; if the reader would retain more names but lose
the relation, group, split, exemplify, or delete instead. Prefer one mechanism, consequence, and decision path over a survey
of valid controls; move implementation detail out when it does not change the reader's teach-back. Before retaining a
correction, limitation, or conclusion from the user's reasoning, apply the standalone-reader test: can the reader tell what it
qualifies or follows from in the note's local context? If not, add the smallest missing premise, restate it as a direct
boundary, or delete it. Use a running example when it makes the mechanism observable; use separate examples only when they
clarify distinct choices.

Read `references/obsidian-writing-style.md` for Markdown choices. Use ordinary paragraphs by default; use headings,
tables, callouts, code, Mermaid, and links only when they improve scanning, comparison, execution, or causal clarity.
If the user explicitly requests Mermaid, include a real Mermaid block. Read `references/mermaid.md` before drawing.

For an update, preserve unrelated frontmatter, paragraphs, links, examples, and format blocks. Delete or rewrite only
when the content is wrong, duplicated, out of scope, explicitly retired, or necessary to repair the teaching path.

## 5. Safe write

For a new note, prove the target is absent. For an update, read the original bytes and compute `original_hash`.

1. Acquire the target lock before reading the final original hash.
2. Write the draft to a same-directory temporary file.
3. Read the temporary file back and run `node scripts/check-note.ts` against those exact bytes.
4. For an update, verify the original hash again under the lock and check preservation.
5. Atomically replace the target when possible.
6. Read the final target back, compute `final_hash`, and run the same checks again.

If the target changed, replacement failed, or read-back is uncertain, stop all writes and report an uncertain state. Do
not create runtime bundles, journals, format plans, or setup state for a normal invocation.

Read `references/mechanical-gates.md` before the mechanical gate. It defines what the scripts can prove and what remains
semantic review.

## 6. Mandatory review

Read `references/review-lifecycle.md` before dispatching either reviewer. Review the exact final note bytes, not a summary
or stale draft. Follow that reference for clarity/accuracy scope, per-axis two-round ceiling, exact-hash review, and revision
handling. A reviewer may not rewrite the note directly. Clarity is the teaching gate: accuracy and mechanical validity cannot
rescue a note whose core judgment, concrete problem, mechanism, example, or resulting choice is not recoverable.

## 7. Delivery report

Report only facts from the final read-back and review record:

- absolute or vault-relative note path;
- `created`, `updated`, or `unchanged`;
- final hash and write/read-back result;
- clarity and accuracy result;
- corrections, unverified claims, and blockers;
- `Mermaid 渲染未验证` when applicable.

Use a success label only when the write/read-back, mechanical checks, both reviews, and required links pass. A blocked,
uncertain, or reviewer-unavailable run must say so plainly.

## Mechanical checks

`node scripts/check-note.ts --file NOTE --vault-root VAULT [--original ORIGINAL] [--json]` is the one public note checker.
It covers Markdown surface safety, heading structure, vault links, and update preservation. The focused scripts remain
available for diagnostics but are not separate workflow phases. Run their self-tests only in development/CI, not during
every user invocation.

Do not turn these invariants into extra schemas: the note bytes, source ledger, target path, original hash, final hash,
two review results, and write outcome are sufficient evidence.

## Never do

- Do not write before route, target, containment, and collision decisions are settled.
- Do not guess a filename, heading, block ID, source, or version boundary.
- Do not call a partial vault scan complete.
- Do not replace an update after its original bytes changed.
- Do not claim clean review from a timeout, empty poll, contradictory payload, or missing coverage.
- Do not treat a mechanically valid all-H1 outline as semantically correct, and do not force depth merely to improve a
  heading count.
- Do not put reviewer prose, audit state, or process status into the note body.
