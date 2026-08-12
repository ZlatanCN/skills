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

**Operating contract**

**Write one standalone Chinese Obsidian note for a future reader.** Follow one path; do not invent quick, strict, or
formatting-only variants.

`reader contract → vault target → evidence → causal draft → safe write → clarity + accuracy review → report`

**Review findings diagnose teaching units; they are not line-edit instructions.** Rebuild the affected unit instead of
patching a stale draft.

If review finds actionable problems, treat findings as diagnoses of affected teaching units, not line-edit instructions.
Reconcile the findings, rebuild each affected unit from premise/problem through mechanism, example, boundary, transition, and
choice, make one integrated revision, write it safely, read it back, and review the new exact bytes. Do not stack patches on a
stale draft or create a second workflow for “strict” or “quick” work.

## Non-negotiable contract

> **Rules that override convenience**
>
> - **Write by default** into the resolved Obsidian vault.
> - **Review twice, independently:** `clarity` and `accuracy` are separate gates.
> - **Never write** an unsupported material claim, guessed link, unsafe path, or unverified replacement.
> - **Keep raw user wording out of the note.** The body contains the adjudicated domain claim, not the conversation.
> - **Never report success** after a failed or uncertain write.
> - **Honor an explicit no-write request early.** It is an early return, not a second workflow.

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

> **Structure before polish**
>
> Build the teaching tree and complete the teaching units **before** naturalness or formatting polish. If wording exposes a
> structural or factual problem, stop polishing and return to the affected unit.

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

Before writing, run the sibling test: name the immediate parent question for every proposed H2/H3; do the proposed siblings
share that parent question; can each stand alone without the preceding section; does the parent genuinely summarize all
children; and would removing the heading lose navigation rather than only visual emphasis? If any answer is unclear, redraw
the tree. The causal spine sets teaching order, not heading depth. Never invent a parent merely to avoid an all-H1 note, and
never keep unrelated chapters flat merely because H1 siblings are mechanically legal.

Open with the core judgment and concrete problem. Then split the material into independent teaching units, each with one
job: establish a phenomenon, explain one mechanism, show its observable example, state its boundary, or make a choice. Treat
each paragraph as a licensed teaching move, not merely a true claim: identify the prior question or mechanism it answers, its one
job, and the later explanation or decision that needs it. If it introduces a new topic without recoverable local context, delete
it first; move it only when it belongs elsewhere, or add the smallest in-scope premise only when that premise stays within the
existing spine. Connect units with explicit transitions rather than one large paragraph. A semicolon or connective phrase must
not hide a change of subject, mechanism, or reader task; split the sentence or paragraph when it does. Then teach the causal
path: why the problem occurs, how the mechanism changes it, what the reader can observe, and which choice follows. Do not
compress different classification axes, predicates, or paragraph roles into one comma-separated list. For a necessary enumeration, state its
shared axis or action and return to the current decision; if the reader would retain more names but lose the relation, group,
split, exemplify, or delete instead. Prefer one mechanism, consequence, and decision path over a survey of valid controls; move
implementation detail out when it does not change the reader's teach-back. Before retaining a correction, limitation, or
conclusion from the user's reasoning, apply the standalone-reader test: can the reader tell what it qualifies or follows from in
the note's local context? If not, add the smallest missing premise, restate it as a direct boundary, or delete it. Use a running
example when it makes the mechanism observable; use separate examples only when they clarify distinct choices.

After teaching units and surfaces are composed, run a bounded naturalness pass before review. Write direct technical Chinese:
remove filler, praise, promotional claims, vague authority, formulaic transitions, empty summaries, forced contrasts, and
unnecessary three-item rhetoric; prefer simple verbs and explicit subjects. Keep uncertainty and technical qualifiers, vary
sentence rhythm without adding personality as decoration, and rewrite literal translations when a precise Chinese expression
exists. This pass may change wording only; it must not alter claim scope, protocol mappings, teaching-unit boundaries, causal
order, surfaces, or review findings. If wording exposes a structural or factual problem, return to unit-level revision instead.

Read `references/obsidian-writing-style.md` for Markdown choices. Choose the smallest surface that preserves the reader's job:
prose for explanation, code for executable behavior, tables for aligned comparison, Mermaid for relationships, and callouts for
content with an independent attention or retrieval function. Ordinary paragraphs remain the default, not a ban on richer
surfaces: when a reader would otherwise reconstruct a key flow, sequence, state, entity relation, or timeline across paragraphs,
choose the Mermaid type that answers that question; when a core judgment, boundary, warning, stop rule, example, or model would
be lost during scanning, choose the matching callout type. Treat reminder phrases such as “注意”, “第一原则”, “关键认知”,
or “需要明确” as prompts to evaluate callout fit, not as automatic conversions; a boundary or stop rule without such a phrase
still needs the same evaluation. Do not add formats for quota or decoration. If the user explicitly
requests Mermaid, include a real Mermaid block. Read `references/mermaid.md` before drawing.

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

> **Review is a release gate**
>
> Read `references/review-lifecycle.md` before dispatching either reviewer. **Clarity and accuracy are independent; one cannot
> cancel the other.** Review the exact final bytes, never a summary or stale draft.

Read `references/review-lifecycle.md` before dispatching either reviewer. Review the exact final note bytes, not a summary
or stale draft. Run clarity and accuracy independently when both axes are needed; each axis uses its own evidence and question,
but both may cite the same note passage. A reviewer may not rewrite the note or dispatch another reviewer. Follow that
reference for per-axis two-round ceiling, exact-hash review, and revision handling. Clarity is the teaching gate: accuracy and
mechanical validity cannot rescue a note whose core judgment, concrete problem, mechanism, example, or resulting choice is not
recoverable.

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

> **Hard stops**
>
> - **Do not write** before route, target, containment, and collision decisions are settled.
> - **Do not guess** a filename, heading, block ID, source, or version boundary.
> - **Do not call** a partial vault scan complete.
> - **Do not replace** an update after its original bytes changed.
> - **Do not claim clean review** from a timeout, empty poll, contradictory payload, or missing coverage.
> - **Do not confuse syntax with teaching.** A mechanically valid all-H1 outline is not semantically correct.
> - **Do not put** reviewer prose, audit state, or process status into the note body.
