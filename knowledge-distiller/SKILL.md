---
name: knowledge-distiller
version: "0.3.0"
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
teaching_model  → section tree, roles, relations, transitions, heading convention
vault_snapshot  → root/scan status, manifest, candidates, collision decision, link ledger
target          → requested path, canonical path, scope, containment, symlink check
draft           → path, note_revision, body map, content hash, self-check state
write_tx        → original/final hash, temp state, atomicity, read-back, write_status
review_journal  → cycle/attempt IDs, provider/parent/cancel states, events, findings, fallback
delivery        → label, blockers, corrections, mutations, open items
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

Read `references/reader-model.md` §2–3. Convert the ledger into an adjudicated teaching model before composing:

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
role, relation, boundary, parent, children, `why_next`, and heading level. The tree expresses the intended teaching
model; a post-hoc summary of drafted prose is not a checkpoint.

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

Read `references/reader-model.md` again. Write from the adjudicated section tree, never in source-return order or as a
technology list. Map every top-level section and every material paragraph to a claim, role, dependency, transition,
and boundary. Use `keep`, `rewrite`, `move`, `merge`, `split`, `delete`, `defer`, or `add`; technically correct prose
without a current job in the spine is classified as `defer` by default, and is removed only through the explicit
`delete` rule and preservation diff below.

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
`old_hash`, unchanged byte ranges, changed ranges, and the operation for each changed unit. This is how structural
recomposition and preservation of unrelated content remain compatible and auditable.
Do not add a duplicate `# Title` when the filename is
the implicit title. In the implicit convention, major chapters are `#`; in an explicit-title convention, the matching
title is the root and chapters are `##`. A child is exactly one heading level deeper than its parent. Name sections
after the question or decision they resolve, not merely a product or noun.

Teach the causal model before advice: why mechanisms exist, how they work, what they compose with, and where they stop.
Give each paragraph one job and make non-obvious transitions explicit. Avoid `Introduction`, `Conclusion`, `总结`,
table-of-contents, and dedicated “see also” sections. Use a running example when it reduces abstraction.

Use callouts only when they make a misconception, trade-off, uncertainty, or example materially easier to find. Keep
the main clause easy to follow; use a short parenthetical for a gloss, move multi-clause definitions into their own
sentence, and never nest paired em dashes. Use Mermaid only for a structural or temporal relationship that prose
explains less clearly; read `references/mermaid.md`
first, keep it small, and report `Mermaid 渲染未验证` if it cannot be parsed/rendered in the environment.

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

Keep these states separate:

```text
checker_self_test   → passed | failed | unavailable
actual_vault_check  → passed | failed | unavailable
mechanical_link_gate→ passed | failed | unavailable
semantic_link_gate  → passed | failed | unavailable
heading_gate        → passed | failed | unavailable
```

Run the checker self-tests before relying on them, recording command, version/commit, exit code, and timestamp. Then
run `node scripts/check-wikilinks.ts --vault-root "<vault-root>" --file "<note-path>"` and
`node scripts/check-heading-tree.ts --strict --file "<note-path>"` against the exact temp and final path as applicable.
A self-test is not an actual-vault pass. The canonical-manifest duplicate scan and semantic link audit are independent
of the bundled checker; if the checker does not enforce global filename/heading/block uniqueness, perform that scan
separately and record its evidence rather than attributing the stronger guarantee to the script. If a checker is
unavailable, record the manual equivalent; an unavailable gate with no equivalent blocks clean delivery.

After final read-back, re-read every semantic link target and compare its recorded excerpt/content fingerprint and
definition. If any target changed, invalidate the snapshot/link ledger and repeat Phase 4. A mechanically valid but
semantically unknown link is not clean.

## 8. Phase 7 — review as an evidence-bound event stream

Review improves confidence but does not authorize an unsafe write. Spawn the two read-only reviewers in parallel when
the environment supports it, using the exact prompts in `references/review-lifecycle.md` §8. Substitute the resolved
absolute path and metadata; never pass an unresolved placeholder. If the write status is not `written`/`updated`, use
only the draft fallback and no path-based reviewer.

An asynchronous reviewer requires a durable append-only journal. Before dispatch, persist a lifecycle checkpoint with
`cycle_id`, `attempt_id`, axis, path, `note_revision`, immutable `draft_hash`, parent cutoff, a provider operation ID
when one exists, otherwise a client dispatch ID, and observability mode. The pre-dispatch record may therefore have
`provider_operation_id: pending`; fill it only from provider evidence after submission. The client dispatch ID is the
stable local identity before provider acknowledgement; once an operation ID exists, store both and never use the
operation ID as a replacement for `attempt_id`. If the journal is unavailable, do not dispatch; run the complete
manual fallback and report `journal_unavailable`. A client submission proves neither provider acceptance nor
completion.

Keep these dimensions independent:

```text
provider_execution_state → pending | active | completed | failed | unknown
provider_liveness       → unobserved | healthy | suspected_stall | terminal
parent_wait_state        → waiting | deferred | closed
cancel_state             → not_requested | cancel_requested | canceled_confirmed | unknown
quality_result           → clean | actionable | protocol_invalid | unavailable
```

`deferred` records only that the parent stopped waiting. Opaque or empty observations remain `unknown`. A provider's
terminal `failed` goes directly to fallback and sets `provider_liveness: terminal`; it is never a cancellation case.
Only provider-observed, nonterminal stall evidence may set `provider_liveness: suspected_stall` and enter
`cancel_requested`; only a matching provider acknowledgement yields `canceled_confirmed`. If an exact completed result
event precedes the cancellation acknowledgement in journal `order`, accept the completed result, mark the cancellation
acknowledgement `superseded`, and never set `canceled_confirmed`. If cancellation is confirmed first, a later completed
payload for that attempt is a contradictory provider event (`protocol_invalid`), not a clean result. A cancel request
cannot erase a completed result that was evidenced first.

The reviewer reference's legacy single-state terms map mechanically to this record: `pending|queued →
provider_execution_state: pending`; `running|active → active`; `completed → completed`; `failed → failed`;
`deferred → parent_wait_state: deferred` while provider execution remains active or unknown; `cancel-requested →
cancel_state: cancel_requested`; `canceled-confirmed → canceled_confirmed`; `suspected-stall →
provider_liveness: suspected_stall`; a nonterminal `stalled` observation follows the same mapping, while a terminal
`failed` observation maps to `provider_execution_state: failed` and never to cancellation. `unknown → unknown`. These
are not alternative states. Store the five canonical dimensions plus the legacy event name when the reference
requires it.

Use this minimal append-only journal schema for every dispatch, observation, fallback, revision, cancellation, and close:

```text
{event_id, order, event_type, cycle_id, attempt_id, axis, note_path, note_revision, draft_hash,
 client_dispatch_id, provider_operation_id, provider_execution_state, provider_liveness, parent_wait_state,
 cancel_state, state_before, state_after, observability, evidence, observed_at}
```

Append one complete record per event in monotonic `order`; do not overwrite an earlier state. Use a single-writer lock
(`flock` or the environment's equivalent) around read-order-increment-append-flush; if no lock and durable flush are
available, the journal is unavailable and async dispatch is forbidden. The pre-dispatch event is written before the
provider call. If a post-dispatch append fails, do not relabel the provider as failed/canceled: set
`provider_execution_state: unknown`, `quality_result: unavailable`, `delivery: review-uncertain`, stop new dispatches,
run fallback, and report the unjournaled operation. To close, acquire the same lock, process all
matching results observed before closure, append a `report_closed` event containing the final `cutoff_order`, flush it,
and release the lock. A result observed after that order is `late_ignored`; if the close append/flush is uncertain, set
`report_close_uncertain` and do not claim a clean lifecycle.

Accept a result only when `cycle_id`, `attempt_id`, axis, path, `note_revision`, and `draft_hash` all match. A mismatch,
older revision, or result after the atomic `report_closed` event is journaled as `stale`/`late_ignored`; it cannot
change findings, revisions, convergence, or delivery. An exact terminal result arriving before report closure must be
validated and adjudicated even if the parent had stopped waiting.

The verbatim reference prompt requires `attempt_id`, `note_revision`, and `note_path`; do not invent extra provider
fields. Wrap that prompt and its result in the local dispatch envelope carrying `cycle_id` and `draft_hash`. Validate
the three required returned fields against the envelope, then verify the immutable draft hash locally. If the provider
also returns cycle/hash fields, they must match; if a required returned field is absent or the local artifact hash has
changed, record `protocol_invalid` and use fallback. This closes identity fencing without changing the reference
prompt contract.

Normalize payloads before using them. `clean` requires no C1–C5/A1 findings, no unverified claims, complete accuracy
source coverage, and evidence of the reader after-state. Contradictory fields—such as `clean` with findings or partial
coverage—are `protocol_invalid`, never clean.

Read `references/review-lifecycle.md` §4A before dispatch. Use its prompts and budget, but map its generic lifecycle
terms into the canonical provider/parent/cancel fields above; this section's separated-state and identity rules are
authoritative when the reference uses a single `reviewer_state` or ambiguous transition. The default finite budget is
the initial review plus at most
two integrated revision rounds; only an explicit user request may enlarge it. Track reviewer attempts, fallback
passes, and body revision rounds separately. Never retry the same revision while its attempt is `unknown`, `active`, or
`cancel_requested`; a new body revision is a new cycle, attempt, and hash.

Run `references/final-checklist.md` once before the first dispatch and again after every content revision. A checklist
pass cannot override an unavailable or failed state gate, and a checklist run without the exact draft identity is not a
review of that artifact.

### 8A. Fallback, adjudication, and convergence

Fallback inspects the exact draft hash/revision, not a generic topic. It must record per-axis `passed|failed|unavailable`
for the reader contract and linear spine, evidence/limits of every material claim, every link's mechanical and
semantic target, heading/render gates, and the complete clarity/accuracy C1–C5/A1 checklist. `manual_checked` alone
never means clean. Record each event with an event ID, monotonic order, state before/after, evidence, and operation.

Use findings only after identity and protocol validation. Normalize both axes, remove preferences, duplicates, and
out-of-scope items, then make one integrated edit pass. Restate the reader contract and choose the structural operation
that restores the path: keep, rewrite, move, merge, split, delete, defer, or add. Accuracy repairs need source-backed
wording; clarity repairs need structural reasoning. After every content revision, read the whole note linearly, state
the spine and each top-level section's role, rerun required gates, increment the revision/hash, and invalidate old
review results.

Before closing the report, process all exact results received before `report_closed`. Results after it remain
`late_ignored` and are disclosed. A `reader_blocker` or `accuracy_blocker` means unfinished even if written; only a
`polish_item` may remain under an open-item label. Stop at clean convergence, no actionable repair, budget exhaustion,
or a documented fallback/open item—never chase preferences or invent edge-case work.

## 9. Phase 8 — truthful delivery report

Read `references/review-lifecycle.md` §7 for its write-state vocabulary, using the stricter state contract above when
an example is ambiguous. Report in Chinese and include only sections with content:

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
