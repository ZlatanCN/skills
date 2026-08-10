---
name: knowledge-distiller
version: "0.4.3"
description: >
  Distill a user's rough understanding, notes, or half-formed reasoning about a technical topic into a
  durable Chinese Obsidian note grounded in first-principles explanations and current evidence. Use this
  skill whenever the user shares technical thoughts that need fact-checking, structure, correction, or
  connection to an existing vault, even when they do not explicitly ask to create a note. Do not use it for
  a plain factual question with no user-supplied understanding, simple polishing, or general vault operations.
---

# Knowledge Distiller

Act as a senior engineer writing for a future reader. Transform raw technical understanding into one standalone,
durable Chinese Obsidian note that teaches a causal model, preserves uncertainty, and fits the existing vault without
inventing connections. The note is the artifact; the conversation report is the audit trail.

## 0. Operating contract

Truth, scope, vault integrity, renderability, security, and safe writes are hard constraints. Smooth prose, a high
review score, or a complete-looking file never overrides them. Research returns, vault results, and reviewer findings
are raw inputs: they enter the note only through an adjudicated claim ledger and teaching model. Never put the user's
mistakes, conversation framing, review status, or generation process into the note body.

An explicit request for language, title, path, metadata, structure, or output format overrides these style defaults, but
never overrides factual integrity, preservation of unrelated vault content, security, containment, or safe-write gates.

An invocation has exactly one `route` and one `write_policy`:

```text
route        → answer_only | clarify | distill_note
write_policy → draft_only | allowed | blocked
```

`answer_only` and `clarify` terminate before any setup or vault side effect. `draft_only` permits reasoning and an
in-memory draft but no persistent mutation of any kind. `allowed` still requires every later safety gate. `blocked`
means the cycle cannot safely proceed; do not silently downgrade it to a draft merely to produce output.

The workflow is a state machine, not a prose checklist. Maintain one execution record for the current invocation:

```text
route, write_policy
reader_contract → reader, question, after, scope, spine, axes, dependencies
setup           → state check, optional capabilities, fallback
research        → status, sources, claim ledger, gaps
teaching_model  → section tree, roles, relations, transitions, heading convention, format_policy
vault_snapshot  → root/scan status, manifest, candidates, collision decision, link ledger
target          → requested path, canonical path, scope, containment, symlink check
draft           → path, note_revision, body map, format_plan, content hash, self-check state
write_tx        → original/final hash, temp state, atomicity, read-back, write_status
review_journal  → cycle/attempt IDs, provider/parent/cancel states, events, findings, fallback
delivery        → label, blockers, corrections, mutations, open items
mechanical_evidence → checker JSON, exact input hashes, gate states, commands, versions, exit codes
```

Use these status words literally. `complete`, `partial`, and `unavailable` describe evidence availability; `passed`,
`failed`, and `unknown` describe a gate or observation. `deferred` is only the parent's wait boundary. It is never a
provider failure, cancellation, or clean result.

Advance only when the phase contract is valid:

| Phase | Must produce | Must stop or return when |
| --- | --- | --- |
| 0 route | reader contract + route + write policy | question, scope, after-state, or side-effect constraint is unresolved |
| 1 setup | capability/fallback state | a draft-only run would write setup state |
| 2 evidence | claim ledger + `research_status` | a material claim has no support, qualification, or exclusion |
| 3 model | section tree and teaching spine | any section lacks question, role, dependency, boundary, or `why_next` |
| 4 vault | root/scan state + target + collision + link ledger, or an explicit no-link draft disposition | for `allowed`, path/containment/anchor/scan/collision is unresolved; for `draft_only`, the no-link disposition is missing |
| 5 draft | every body unit mapped to the model | prose, link, table, or diagram has no admitted role |
| 6 write | transaction/read-back for `allowed`, or in-memory `not_written` disposition for `draft_only` | `blocked` reaches this phase, a draft-only run attempts persistence, write state is uncertain, or a hard gate fails |
| 7 review | valid exact results or complete fallback | an opaque attempt has no journal evidence or fallback |
| 8 delivery | truthful label and report | any blocker would be hidden by a success label |

If a later phase changes the reader, scope, axes, section relations, target, claim support, or note bytes, invalidate
all downstream artifacts from the earliest affected phase. A stale draft, link ledger, or review result cannot be
reused just because its filename is unchanged.

## 1. Phase 0 — route, reader, and authorization

Read `references/reader-model.md` before this phase. Extract the topic/title, in-scope and out-of-scope questions,
claims needing verification, misconceptions, prerequisites, possible diagrams, and dependencies. State the reader's
after-state and one-sentence spine. If independent problems cannot share one spine, split them or choose a narrower
angle; a broad but coherent input gets a stated boundary rather than an unnecessary clarification.

Choose exactly one route before mandatory research:

- `answer_only`: a plain factual question with no user-supplied understanding to distill. Answer it directly and stop.
- `distill_note`: raw understanding exists and should become a durable note; continue through Phases 1–8.
- `clarify`: unrelated topics or an output choice that cannot be inferred safely. Ask one concise question and stop.

Derive `write_policy` before any tool that can change state:

- `draft_only`: an explicit request not to create, update, persist, save, or write files. No `state.json`, review
  journal, temporary file, backup, generated block ID, directory, or note may be written. Keep the draft and audit in
  memory and report `not_written`.
- `allowed`: only for `distill_note` without an explicit no-write constraint. It authorizes the final note transaction,
  not unsafe paths, duplicates, guessed links, or unverified replacement.
- `blocked`: always for `answer_only`/`clarify`, and whenever a root, target, collision, containment, or hard safety
  gate is unresolved or failed.

Interpret “只回答/不用整理成笔记” as `answer_only`; interpret “整理成草稿但不要落盘” as
`distill_note + draft_only`. Preserve the skill's implicit note behavior when raw understanding is supplied without a
conflicting constraint. If the user explicitly requests multiple independent notes, create a separate full cycle and
execution record for each topic; do not share a target, collision decision, claim ledger, or reviewer attempt across
cycles.

🔴 CHECKPOINT · ROUTE / SIDE-EFFECT GATE

Record `route`, `write_policy`, reader, question, after-state, scope, spine, axes, and dependencies. Then:

- `answer_only` → stop; do not run setup, research, vault scanning, writing, or review.
- `clarify` → ask the one question and stop; do not create a partial note or persistent clarification artifact.
- `draft_only` → continue only with read/reason operations; every persistent mutation remains forbidden.
- `allowed` → continue to Phase 1; later gates may change the policy to `blocked`.

## 2. Phase 1 — optional capabilities without hidden setup writes

Run this phase only for `distill_note`. Locate `**/knowledge-distiller/scripts/setup-state.sh` with the environment's
file-search tool. If it does not exist, record `setup: unavailable` and continue with manual fallbacks; do not ask about
extensions. If it exists, run the read-only form:

```bash
bash "<script-path>"
```

Interpret the result as follows:

- exit `0`: `state.json` exists and suppresses a repeated install-choice prompt; it does not prove either optional
  skill is available. Verify capability through the environment's skill mechanism before invoking it.
- exit `1`: check `humanizer-zh` and `obsidian-markdown`, record each as available/missing, and use the documented
  fallback for missing skills.
- any other exit/error: record `setup: incomplete`, do not write state, continue with fallbacks, and report the gap.
- never write setup state during Phase 1. If all optional capabilities are available, record
  `setup_write: pending`; perform the `write` form only after Phase 4's target/collision gate and Phase 6's successful
  final read-back, or after the user explicitly chooses “记住我的选择” in Phase 8. A failed state write is
  `state_write_failed`; it never blocks note quality by itself, but it must not be reported as persisted.
- with `draft_only`, never run the `write` form. No optional-skill preference is persisted during this invocation.

An optional skill is an aid, not evidence. Its absence does not justify weaker factual, structural, link, or write
gates. A durable asynchronous review journal is a different requirement and is handled in Phase 7.

## 3. Phase 2 — evidence and the claim ledger

Research is mandatory for a new or materially updated technical note, but not for `answer_only`. Use the reader
contract and spine to form 2–4 targeted discovery queries by default; continue for niche or high-stakes questions until
new evidence no longer changes the reader path. Discovery is complete when the failure model, mechanisms,
alternatives/composable axes, boundaries, and required decision are supportable—not when every named technology has a
URL.

Prefer, in order: standards/RFCs/official specifications and primary research; official project documentation and
release notes; then well-regarded technical writing when primary material is inaccessible or insufficient. For each
material claim, keep a ledger entry, not prose:

```text
C1 claim and exact scope/version
status       → supported | nuanced | corrected | conflicting | unverified
source       → exact URL/document section and accessible range
support      → what that range establishes
limits       → what it does not establish
decision     → include | qualify | correct | defer | drop
body_role    → premise | mechanism | example | boundary | decision
```

Maintain `research_status → complete | partial | unavailable` independently of claim status. Record source
accessibility, retrieval/version context, exact support range, and limits. A URL, title, search snippet, or remembered
fact is not evidence when the source cannot be inspected. If all relevant external sources are unavailable, use only
directly verifiable local evidence; otherwise mark central claims `unverified` and `qualify`, `defer`, or `drop` them.
An unsupported central causal model is an `accuracy_blocker`, not a source-complete delivery. Do not use one source to
prove unrelated claims. Retain source proximity in the final note for version-sensitive, quantitative, surprising, or
operational claims; do not paste a bibliography dump.

🔴 CHECKPOINT · CLAIM GATE

Every material sentence in the intended body must map to a ledger entry whose support covers the stated scope. A
conflicting or partial claim must carry its conditions and limits. If the ledger changes the reader, scope, axes, or
after-state, return to Phase 0; if it only lacks or conflicts with evidence, repair Phase 2 before continuing.

## 4. Phase 3 — teaching model and section tree

Read `references/reader-model.md` §2–3 and `references/obsidian-writing-style.md` §1–3. Convert the ledger into an
adjudicated teaching model and format policy before composing:

```text
原始主张 → 证据判定 → 修正后主张 → 正文处置
读者作用 → 依赖 → 来源/原因 → 边界 → 下一问
```

Restate the central question and one-sentence spine. For every surviving claim, choose `include`, `qualify`,
`correct`, `defer`, or `drop`; assign one primary role and dependency. Each section must answer a necessary question,
state its boundary, and connect to the next section with a `why_next` edge. Give each mechanism one primary axis and
label secondary composable axes instead of presenting them as alternatives. Resolve source conflicts by conditions,
not silent preference.

The complete section blueprint must contain, for every node: question, answer, prerequisites, admitted claims/examples,
role, relation, boundary, parent, children, `why_next`, heading level, and any required emphasis/callout/diagram
candidate. The tree expresses the intended teaching model; a post-hoc summary of drafted prose is not a checkpoint.

🔴 CHECKPOINT · TEACHING MODEL GATE

Stop before vault scanning or drafting if any section lacks a question, answer, dependency, boundary, or `why_next`,
or if a fact has no reader role. Return to the earliest affected phase and rebuild the model. This is where raw
understanding is corrected; do not leave correction to reviewer prose.

## 5. Phase 4 — canonical vault scan, target, and links

Resolve one absolute `vault_root`: an explicit user path first, then the runtime's known workspace/vault root. Record
`vault_root_status → resolved | unavailable` and `vault_scan_status → complete | partial | unavailable`, including
the canonical manifest, exclusions, root, and permission/tool errors. Scan Markdown files and filenames under that
root while excluding `.git`, `.obsidian`, generated artifacts, and skill implementation files unless they are the
subject. Only a complete scan may support “no related note exists”.

Read relevant MOCs and enough of related notes to identify actual definitions. Decide whether to update an existing
same-topic note or create a genuinely distinct angle. By default:

- one same-topic candidate without an explicit path → update it in place;
- several candidates without an explicit choice → `route: clarify`, `write_policy: blocked`, ask one question, stop;
- an explicit existing same-topic path → update that path;
- an explicit new path with a same-topic candidate → create only when the user explicitly requests a new standalone
  note/distinct angle; otherwise clarify.

Canonicalize `target`: resolve the requested path against the root, reject `..` traversal, and check every component
for symlink escape. Default `target_scope` is `inside_vault`. An absolute path outside the root is permitted only when
the user explicitly supplied it; mark `explicit_out_of_vault`, use no vault-derived links, and mark the vault-link gate
unavailable. Otherwise set `write_policy: blocked`.

🔴 CHECKPOINT · VAULT / COLLISION GATE

Do not compose or write while target containment, symlink check, or same-topic choice is unresolved. On a collision,
do not write setup state, a draft file, review journal, block ID, or note; ask the missing choice and stop. For root/scan
availability, use this deterministic branch:

| Root/scan state | `allowed` | `draft_only` |
| --- | --- | --- |
| resolved + complete | continue with target and link gates | compose in memory; links still need the same gates |
| resolved + partial | set `blocked`; do not compose or write | compose in memory with all vault-derived links omitted; report `partial` |
| unavailable | set `blocked`; request a valid root; do not compose or write | compose in memory with no vault-derived links or target claim; report `not_written` |
| explicit, safe `target_scope: explicit_out_of_vault` supplied by the user | write only that target; no vault links; `actual_vault_check: unavailable` and never clean | compose in memory; no vault links |

Apply this precedence before using the table: (1) route/write policy is fixed by Phase 0; (2) collision,
containment, and symlink failures always block—even for a draft; (3) an explicitly supplied, safe
`explicit_out_of_vault` target uses its dedicated row regardless of vault scan status; (4) all other requests use the
root/scan rows. The `draft_only` column and the explicit out-of-vault row are the only ways an unresolved root/scan can
reach Phase 5. An explicit path does not make vault-derived links available. A blocked run does not claim vault
integration, does not emit cross-note links, and never changes `write_policy` into a successful draft implicitly.

### 5A. Link ledger: mechanical and semantic identity

Treat each wikilink as a serialized reference, not as decoration. Start with at most five central concepts. Use only
anchors copied from actual files:

```text
link → exact relative path + exact heading or legal block ID + alias
mechanical target → one included file, one unique anchor
semantic target → bounded passage/excerpt or hash + why it defines the alias
snapshot → scan/target revision to invalidate if bytes change
```

If the vault already defines a concept, link to its exact defining heading/block and do not re-explain that definition
as a competing body section; add only the local context needed for this note. If no defining target exists, explain the
concept locally and omit the link rather than inventing one.

Read `references/wikilinks.md` before writing links. Use `[[Note#Exact Heading|概念别名]]` or
`[[Note#^unique-block-id|概念别名]]`. A bare whole-note link is not a substitute for a missing definition. If no
suitable anchor exists, add a unique block ID to the existing note only
when that vault mutation is explicitly allowed; otherwise omit the link and report the missing connection.

Perform two independent checks. Mechanical resolution must find exactly one file and one unique heading/block within
the canonical manifest. Build the manifest deterministically: resolve `vault_root` with `realpath`; recursively include
only regular, non-symlink Markdown files whose realpath stays inside the root; exclude the exact directory names
`.git`, `.obsidian`, `.agents`, `.codex`, `node_modules`, `dist`, `build`, `generated`, and `artifacts`, plus the
resolved skill-implementation directory. Sort normalized relative POSIX paths and record
`{relative_path, realpath, basename, content_hash, headings, block_ids}`. Use SHA-256 over file bytes for
`content_hash`, Unicode NFKC + surrounding-whitespace trim + locale-independent case-fold for duplicate filename keys,
and SHA-256 over UTF-8 canonical sorted JSON (no insignificant whitespace) for `manifest_hash`. Persisting this
manifest is not required for a draft-only run; its in-memory object and hash are still required for its link decision.

Within each target note, strip frontmatter and fenced code; count normalized heading occurrences and accept a block ID
only when `^id` is the final non-whitespace token of a non-fenced paragraph matching `[A-Za-z0-9_-]+`. A partial or
unavailable scan sets every vault-derived link gate to `unavailable` and requires omitting those links; an explicit
path is not permission to pretend that an incomplete manifest is complete. Record
`{root_realpath, exclusions, errors, manifest_hash, duplicate_keys, scan_status}` even when the manifest is empty. A
duplicate normalized filename makes an unqualified basename link `failed`; a path-qualified link may pass only when its
exact normalized relative path occurs once. A duplicate heading or block ID within the target note makes that anchor
`failed`; no fallback may choose the first occurrence. A skipped symlink is absent from the manifest, not a valid target.
Reject duplicate targets, frontmatter/inline/fenced false positives, and anchors found only in excluded/generated
files. Semantic resolution must show that the target passage defines or materially explains the linked concept and
record `{target_hash, excerpt, definition_reason, result}`. A mechanical pass is not a semantic pass. If the target
bytes or meaning change after the scan, invalidate the link ledger and rescan.

## 6. Phase 5 — compose from the model

Read `references/reader-model.md`, `references/obsidian-writing-style.md`, and `references/mechanical-gates.md` again. Write from the adjudicated section tree, never in source-return order or as a
technology list. Map every top-level section, every material paragraph, and every retained format block to a claim,
role, dependency, transition, boundary, and format decision. Use `keep`, `rewrite`, `move`, `merge`, `split`, `delete`,
`defer`, or `add`; technically correct prose
without a current job in the spine is classified as `defer` by default, and is removed only through the explicit
`delete` rule and preservation diff below.
For an existing note, classify every old format block—emphasis, callout, code, table, diagram, link, embed, or footnote—
with the same operation and a reader-model reason. Deleting a format block only because its plain-text content remains is
not sufficient; if its visual or navigational function is lost, preserve or redesign it.
Create the machine-readable `knowledge-distiller.format-plan.v1` described in `references/mechanical-gates.md`; prose
in the execution record is not a substitute for its hash and line coverage.

### 6A. Language and terminology

Expository prose is Chinese unless the user requests another language. Keep code, identifiers, formulas, protocol and
product names, standards, URLs, citations, and conventional English technical terms. On first use, write
`中文名（English）` when Chinese is normal, otherwise keep the conventional English and explain it once if needed.
Use the vault's established term when one exists; do not invent translations for conventional terms such as `token`,
`softmax`, or `LLM`. Define every non-obvious formula symbol nearby. Do not write conversation framing such as `你说的`,
`你的理解`, or `这里要纠正`.

### 6B. Frontmatter and body

For a new note use 3–5 specific English tags, PascalCase where the term permits and official brand/project casing
where it does not:

```yaml
---
tags:
  - PascalTag1
  - PascalTag2
  - PascalTag3
summary: "用 1–2 句话说明覆盖什么，以及为什么值得保留。"
---
```

Preserve existing frontmatter, unrelated body content, and vault-local fields on update unless the teaching model
explicitly admits a replacement. Never delete unrelated paragraphs, metadata, or links merely to simplify the note.
For an existing note, classify each old paragraph as `keep`, `rewrite`, `move`, `merge`, `split`, `delete`, or `defer`
before changing it. Preservation is the default: a paragraph with no current Teaching Model role becomes `defer`, not
delete. `delete` is an explicit exception allowed only for an incorrect, duplicate, out-of-scope, or explicitly retired
paragraph, with a recorded reason and user-requested full-recomposition scope when applicable. For every update, record a preservation diff with
`old_hash`, unchanged/changed line ranges, exact draft hash, and the operation for each changed unit. This is how structural
recomposition and preservation of unrelated content remain compatible and auditable.
Do not add a duplicate `# Title` when the filename is
the implicit title. In the implicit convention, major chapters are `#`; in an explicit-title convention, the matching
title is the root and chapters are `##`. A child is exactly one heading level deeper than its parent. Name sections
after the question or decision they resolve, not merely a product or noun.

Teach the causal model before advice: why mechanisms exist, how they work, what they compose with, and where they stop.
Give each paragraph one job and make non-obvious transitions explicit. Avoid `Introduction`, `Conclusion`, `总结`,
table-of-contents, and dedicated “see also” sections. Use a running example when it reduces abstraction. The complete
format policy, including emphasis, callouts, Markdown surface, code, diagrams, links, and removal tests, is defined
only in `references/obsidian-writing-style.md`; do not duplicate its detailed rules here. Mermaid syntax, diagram
scope, rendering and fallback rules are defined only in `references/mermaid.md`; read that reference before drawing and
report its required `Mermaid 渲染未验证` status when rendering is unavailable.

## 7. Phase 6 — fail-closed write transaction and verification

Branch on `write_policy` before any write-capable tool:

- `draft_only` → compose only in memory, `write_status: not_written`; do not create a directory, temp file, backup,
  `state.json`, journal, block ID, or target; skip path-based review.
- `blocked` → do not compose or write; return the exact clarification/safety blocker.
- `allowed` → continue only after the Phase 4 target and collision gates pass.

🔴 STOP · WRITE GATE

Before an allowed create/update, record the exact canonical path, target scope, collision decision, preservation scope,
and intended write state. For an update, read original bytes and record `original_hash` plus a recovery handle. The
preservation scope includes unrelated body paragraphs, frontmatter properties, and vault-local links. Write
the draft to a same-directory temporary file without replacing the target. Read the temp file back, verify the
frontmatter/body boundary, run the heading and wikilink gates against that exact temp, then atomically replace when
possible. If atomic replacement is unavailable, record that fact and use the safest recoverable replacement.

Read the final target back, record `final_hash`, rerun all required gates, and set `write_status` to `written` or
`updated` only after confirmed read-back. If validation fails before replacement, discard the temp. If replacement may
have occurred but recovery/read-back is uncertain, set `possibly_partial`, stop all further writes, and never claim
success.

### 7A. Gate evidence

Read `references/mechanical-gates.md` before relying on any checker. Run every checker self-test once per invocation and
retain its command, version, exit code and timestamp; then run the canonical aggregate command defined in that reference
against the exact temporary and final bytes.

For an update, append `--original "<original-path>" --preservation "<preservation-json>"`; for a new note do not
invent a preservation record.

This aggregate owns the four new-note gates, or five gates for an update when preservation is supplied, and emits one
evidence envelope. `check-wikilinks.ts` remains available
for focused diagnostics, but do not attribute the aggregate result to a checker that was not run. `passed` is a
mechanical pass only; semantic link audit, claim evidence, preservation meaning and render success remain separate.
An unavailable child checker is `unavailable`, not an empty successful result; without a complete equivalent it blocks
clean delivery.

After final read-back, re-read every semantic link target and compare its recorded excerpt/content fingerprint and
definition. If any target changed, invalidate the snapshot/link ledger and repeat Phase 4. A mechanically valid but
semantically unknown link is not clean.

## 8. Phase 7 — review as an evidence-bound event stream

Review improves confidence but does not authorize an unsafe write. Read `references/obsidian-writing-style.md` §5–6 and
`references/review-lifecycle.md`; the reference is the authoritative review protocol and §8 contains the exact prompts.

After the final read-back and hard gates, **must** spawn exactly two independent read-only subagents in parallel when
the environment provides subagents:

- `clarity`: reader model, spine, section roles, transitions, terminology, and format roles;
- `accuracy`: material claims, source coverage, boundaries, examples, tables, diagrams, and links.

Pass each reviewer the resolved absolute path and exact draft identity required by the reference. Wait for both results
before adjudication. Do not call the reviewer unavailable merely because the tool has not yet been searched; only a
real capability or dispatch failure permits fallback. If the write status is not `written`/`updated`, use the exact
draft fallback required by the reference.

Follow the reference's journal validation and closure protocol exactly. The checker is a mechanical aid; it does not
replace reviewer adjudication.

The reference owns the canonical state dimensions, identity binding, journal schema, cancellation precedence, closure
cutoff, and result normalization. Follow those rules without restating or inventing a second local state machine.

Use the reference's bounded convergence rules. After any content revision, rerun the required gates and invalidate
results for the previous draft.

### 8A. Fallback, adjudication, and convergence

If either axis is unavailable or invalid, run the reference's exact-draft manual fallback and report
`manual_checked`; manual fallback is never reviewer `clean`. Adjudicate valid findings together, make one integrated
edit pass, then rerun the required gates and both reviewers for the new draft. Stop at the reference's clean convergence,
fallback, open blocker, or finite budget boundary.

## 9. Phase 8 — truthful delivery report

Read `references/review-lifecycle.md` §7 for its write-state vocabulary, using the stricter state contract above when
an example is ambiguous. Report in Chinese and include only sections with content:

Before presenting the report, materialize its machine-readable `knowledge-distiller.delivery.v1` record and run:

```bash
node scripts/check-delivery-report.ts --report "<delivery-json>" --json
```

The checker is the final anti-overclaim gate. A prose label cannot override its failed or unavailable result.
For `written`/`updated`, the record must identify `artifact_kind`, the absolute `note_path`, and the final read-back
`final_hash`. A passed journal must additionally carry its evidence-file path and SHA-256; the checker re-runs the
journal checker and binds each clean axis to a matching event, attempt, note path, and draft hash. `preservation:
not_applicable` is legal only for `artifact_kind: new_note`, which must also carry a hash-bound creation probe proving
the exact target was absent before the write; an update must use the preservation checker and every written artifact
must report `write_readback: passed`.

```text
✅ 笔记已创建/更新: <absolute-or-vault-relative-path>（N 轮修订）

Use that success line only when write_status is written/updated, final read-back and all required hard gates pass,
and no reader_blocker or accuracy_blocker remains. For draft_only use `未写入（仅草稿）` and include the draft; for
blocked use `未写入（阻塞）`; for possibly_partial say the file state is uncertain and do not claim delivery.

**回答** — only when the user asked an explicit question; give the direct verdict in 1–3 sentences.
**审查状态** — report provider_execution_state, parent_wait_state, cancel_state, quality_result, observability,
  attempt/revision/hash identity, fallback, and any stale/late_ignored events; never infer provider failure from a cutoff.
**收敛判断** — finite budget, reviewer attempts, fallback passes, actual body revisions, and stopping reason.
**标签说明** — the factual reason for the delivery label.
**修正记录** — 原始主张 / 修正为 / 来源 / 为什么.
**额外补充** — verified additions from research.
**未核实** — claims excluded or qualified because evidence was partial/unavailable.
**库内修改** — each existing-note mutation, added block ID, or corrected stale content.
**延伸建议** — only a natural next concept or genuinely missing vault connection.
```

For a written file with a blocker, say `已写入；存在阻塞项，未完成`, not a success. Classify remaining items as
`reader_blocker`, `accuracy_blocker`, `polish_item`, or non-blocking `unverified`. Report `Mermaid 渲染未验证` when
applicable. Map `delivery: review-uncertain` to `已写入；审查状态不确定，未完成` when the file write itself is
confirmed, and to `未写入（审查不确定）` when no confirmed write exists. If Phase 1 found missing optional skills and
state was not written, ask exactly once:

> 检测到 [missing skills] 未安装。选择：**帮我安装**、**不用，记住我的选择**、**下次再说**。

`帮我安装` uses the environment's skill installer and does not alter the note; `不用，记住我的选择` may run the
setup-state write only when the invocation was `allowed` and the note's final read-back already passed; `下次再说`
leaves state untouched. Never persist a choice during `draft_only`, `answer_only`, `clarify`, or a blocked/partial
write.

## 10. Permanent anti-patterns

The following are prohibited because they violate the state contract:

| Forbidden action | Required replacement |
| --- | --- |
| Force a plain question into a note | `answer_only`, then stop before setup |
| Treat search/reviewer text as body prose | adjudicate through ledger → model → editorial rewrite |
| Guess a filename, heading, or link from a snippet | copy from the canonical manifest; omit if not unique |
| Treat `state.json` existence as extension availability | verify the capability separately |
| Call an unavailable/partial scan “no related note” | report scan state and unresolved connection |
| Treat mechanical link success as semantic correctness | audit target definition and fingerprint independently |
| Write when policy/target/collision is unresolved | fail closed, clarify, or return in-memory draft |
| Continue after uncertain replacement/read-back | `possibly_partial`, stop writes, disclose recovery state |
| Call parent cutoff a provider failure or cancellation | separate provider, parent, and cancel states |
| Retry an unknown or active attempt on the same revision | use fallback or a new revision/cycle only |
| Accept a stale/late/mismatched reviewer result | journal it and exclude it from adjudication |
| Call manual fallback or contradictory payload “clean” | record per-axis evidence and use the truthful label |

Run the final checklist in `references/final-checklist.md` after the final read-back and after every content revision.
The checklist supplements this workflow; it cannot override a failed or unknown state gate.
