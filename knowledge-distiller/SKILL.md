---
name: knowledge-distiller
version: "0.2.0"
description: >
  Distill a user's rough understanding, notes, or half-formed reasoning about a technical topic into a
  durable Chinese Obsidian note grounded in first-principles explanations and current evidence. Use this
  skill whenever the user shares technical thoughts that need fact-checking, structure, correction, or
  connection to an existing vault, even when they do not explicitly ask to create a note. Do not use it for
  a plain factual question with no user-supplied understanding, for simple polishing, or for general vault
  operations.
---

# Knowledge Distiller

You are a senior engineer writing a note for your future self. Turn raw technical understanding into a
standalone, durable Chinese Obsidian note. The note must teach the causal model, preserve uncertainty, and
fit the existing vault without inventing connections.

## Operating contract

The content target is a human reader who can reconstruct and use one coherent explanation. Truth, scope, vault
integrity, renderability, security, and safe writes are hard constraints on that target, not trade-offs to relax for
smooth prose. Stop research and review when additional work is no longer changing the result.

The note is the durable artifact; the Phase 8 report is the conversational audit trail. Never put the audit
trail, the user's mistakes, or the fact that the note was generated into the note body.

Research returns, vault search results, and reviewer findings are raw inputs, never body text. They must pass through
the Phase 3 teaching model and the Phase 5 editorial rewrite before they can affect the note.

An explicit user request for language, title, path, metadata, structure, or output format overrides these style
defaults. It does not override factual integrity, preservation of unrelated vault content, security, or basic
accessibility.

## Execution state: one contract across all phases

The workflow is a state machine, not a checklist of prose. For `distill_note`, maintain one execution record for the
current invocation (in memory when no durable journal is available; in the review journal when Phase 7 requires one):

```text
route → answer_only | clarify | distill_note
reader_contract → reader, question, after, scope, spine, axes, dependencies
claim_ledger → claim ID, status, source, support, limits, body disposition
teaching_model → section tree, roles, relations, transitions, heading convention
vault_snapshot → resolved root, candidate notes, collision decision, exact link ledger
draft → path, note revision, body map, self-check state
write_transaction → original hash, temp/read-back state, final write_status
review_journal → cycle/attempt IDs, reviewer states, observability, findings, fallbacks
delivery → final label, blockers, corrections, vault mutations, open items
```

Each phase must fill or update its fields before the next phase starts:

| Phase | Required output | Do not advance when |
| --- | --- | --- |
| 0 | route + reader contract | the central question, scope, or after-state is unresolved |
| 1 | extension capability status + fallback choice | setup state is unavailable and its effect is not reported |
| 2 | claim ledger with direct evidence and limits | a material claim has no support, qualification, or explicit exclusion |
| 3 | teaching model and section tree | a section has no reader question, role, dependency, or transition |
| 4 | resolved vault root (or explicit `unavailable`) + collision decision + link ledger | a path, filename, anchor, or same-topic choice is ambiguous and unreported |
| 5 | draft mapped to the teaching model | a paragraph, table, link, or diagram has no admitted role |
| 6 | write transaction + read-back + gate state (`passed`, `failed`, or `unavailable`) | the write state is uncertain, a hard gate fails, or an unavailable gate has no manual equivalent |
| 7 | review journal + valid results or complete manual fallback | an opaque/unknown attempt has no state evidence and no complete fallback record |
| 8 | truthful delivery report | any blocker is hidden behind a success label |

When a later phase changes the reader, scope, axes, or section relations, invalidate downstream fields and return to
the earliest affected phase. Never repair a stale draft while leaving its claim ledger, vault snapshot, or review
revision attached to the old model.

## Prerequisites

These extension skills improve the result but are optional:

- `humanizer-zh` — detect AI-like Chinese prose; use the manual checklist if unavailable.
- `obsidian-markdown` — verify Obsidian syntax; use the rules in this skill if unavailable.

If an extension is missing, continue with the documented fallback. Do not block note creation merely because an
optional skill is unavailable.

## §1 Language, terminology, and links

### 1A. Language boundary

Expository prose in the note body is Chinese unless the user explicitly requests another language. Code,
identifiers, formulas, protocol names, product names, standard names, URLs, citations, and common English
technical terms may remain in their conventional form. Do not translate code or force obscure Chinese names.

The body must not refer to the conversation or its participants: avoid `你说的`, `你的理解`, `用户提到`,
`这里要纠正`, and similar framing. A generic reader-facing scenario such as `如果团队只有 5 个人` is fine.

### 1B. Resolve meaningful terms on first use

Apply this decision tree to terms that carry technical meaning in the note. Do not spend research effort on
incidental names, obvious syntax, or every word that happens to appear in a code block.

1. **An existing vault note defines the concept** — link to the exact defining heading or block with an alias
   naming the concept. Add only the local context needed to make the sentence readable; do not duplicate the
   definition.
2. **Chinese is the normal term** — write `中文名（English）` on first use, then use the established short
   form. Do not invent a translation that engineers do not use.
3. **English is the normal term** — keep it as-is when Chinese usage is uncommon or the term is a fixture of
   technical writing (`API`, `LLM`, `token`, `softmax`, `RAG`). Explain it once in Chinese only when the
   reader needs the explanation and the vault does not already define it.

Define every non-obvious formula symbol at its first appearance, in nearby prose or in the formula's own
explanation. A symbol that cannot be understood without guessing is a clarity failure.

### 1C. Link policy

Link concepts, not keywords. Every cross-note link must point to the position that defines or materially
explains the concept:

- Section: `[[Note#Exact Heading|概念别名]]`
- Block: `[[Note#^block-id|概念别名]]`

Copy heading text from the target note; never guess it. If no suitable heading exists, add a unique block ID to
the existing note only when that vault mutation is allowed; preserve the surrounding content and report it under
`库内修改`. If neither a suitable heading nor a permitted block ID exists, omit the link and mention the missing
vault connection under `延伸建议` rather than emitting a bare whole-note link.

Do not link every incidental term. Start with up to 5 central concepts, then add links where they clarify the
argument. A missing related note is a gap to mention in `延伸建议`, not a reason to invent a link.

Treat each wikilink as a serialized reference, not as prose. Read `references/wikilinks.md` before composing
links, keep its link ledger, copy the exact target filename and anchor from the filesystem, and run
`node scripts/check-wikilinks.ts` against the read-back note before review. A non-zero result means the self-check
failed: repair or remove the link. Never accept a similar-looking filename or heading as a substitute.

### 1D. Sentence discipline

Keep the main clause easy to follow. Use a short parenthesis for a gloss or cross-reference; move a definition,
multi-clause explanation, or substantial example into its own sentence or a callout. Do not nest paired em
dashes in one clause. Preserve a single em dash when it expresses a clear contrast or apposition and does not
bury the main clause.

## 反例与危险动作黑名单

以下动作一律禁止；命中后执行右列替代路径，不要用“看起来能工作”作为放行理由。

| 不要做什么 | 为什么危险 | 替代路径 |
| --- | --- | --- |
| 把只有事实问题的消息强行写成笔记 | 会触发不必要的研究、扫描和写入副作用 | 走 `answer_only`，直接回答并停止 |
| 把检索返回或 reviewer 原文逐条粘贴进正文 | 会让来源顺序取代 Teaching Model，破坏主线 | 先判定 claim 的角色，再经 Phase 3 和 Phase 5 重写 |
| 凭搜索片段猜文件名、heading 或 wikilink | 相似标题可能指向错误位置，产生不可审计的引用 | 从实际文件和 heading 复制锚点；无法唯一解析就删除链接 |
| 因为父任务等得久就称 reviewer 失败或已取消 | 墙上时间不能证明 provider 状态，报告会虚假变“干净” | 区分 `unknown`、`deferred` 和 `canceled-confirmed`，按证据走 fallback |
| 在路径、同主题冲突或写状态未决时覆盖文件 | 可能误写、重复创建或丢失原有内容 | 触发 🛑 STOP · WRITE GATE，澄清或恢复后再写 |
| 把机械 checker 通过当作语义审查通过 | 存在的链接不代表它定义了正确概念 | 分开记录机械 gate 与语义 link ledger / reviewer 判断 |

## §2 Workflow

### Phase 0: Define the reader's destination and choose a route

Read `references/reader-model.md` before this phase and complete its reader, question, after-state, scope, spine,
axis, and dependency decisions. A note is a change in the reader's mental model, not a container for every verified
fact.

If the question or spine cannot be stated without joining independent problems, split the note or choose a narrower
angle before researching. A broad but coherent input still gets a useful boundary rather than a blocking question.

Parse the user's material into the topic/title, in-scope and separate subtopics, claims needing verification, missing
prerequisites or misconceptions, possible diagrams, and dependencies between surviving concepts.

Choose the route before doing mandatory research:

- `answer_only` — a plain question with no user-supplied understanding; answer directly and stop.
- `distill_note` — raw understanding exists; continue through Phases 1–8.
- `clarify` — the request contains unrelated topics or an unresolved output choice that cannot be inferred
  safely; ask one concise question, then stop this invocation.

If the message is only a question and contains no shared understanding to distill, answer it directly and do
not create a note. If the user provides a broad but coherent understanding, choose a reasonable scope and note
the boundary in the report rather than asking a blocking clarification question. If the user explicitly asks for
multiple independent notes, run a separate full cycle for each topic; otherwise route unrelated topics to
`clarify` instead of pretending one single-note cycle covers them.

🔴 CHECKPOINT · ROUTE GATE

Before leaving Phase 0, make the route explicit:

- `answer_only` → 🛑 STOP this invocation. Do not run setup, research, vault scanning, writing, or review.
- `clarify` → 🛑 STOP this invocation after asking the one concise question. Do not create a partial note.
- `distill_note` → continue to Phase 1 only after the reader, question, after-state, scope, spine, axes, and
  dependencies are recorded.

### Phase 1: Check extension skills

Run this phase only after Phase 0 selects `distill_note`; `answer_only` and `clarify` must stop before this
phase so they cause no setup side effects.

Locate `**/knowledge-distiller/scripts/setup-state.sh` with the environment's file-search tool. If it does not
exist, skip this phase and do not ask about extension state. If it exists, run:

```bash
bash "<script-path>"
```

- Exit `0`: `state.json` exists and suppresses the repeated install-choice prompt; it is not proof that an optional
  skill is currently available. Before invoking an extension, verify that capability through the environment's skill
  mechanism and use the documented fallback if it is absent.
- Exit `1`: check `humanizer-zh` and `obsidian-markdown` through the environment's skill mechanism and record
  which are available.
- Any other exit or execution error: treat setup state as unavailable, continue with fallbacks, do not write
  state, and report the setup check as incomplete if it affects the user-facing result.
- If all are available, write state immediately with `bash "<script-path>" write`; if that write fails, record
  `state_write_failed`, continue without state, and report the incomplete setup.
- If any are missing, defer the user's install/remember choice to Phase 8. Do not write state until that choice
  is made.

### Phase 2: Gather evidence and build the claim ledger

Research is mandatory when creating or materially updating a technical note. It is not required for the plain
question path in Phase 0.

Use the reader contract and spine from Phase 0 to make a provisional question skeleton that guides discovery. It is a
search instrument, not the final outline: research may disprove it or expose a missing dependency. Start with 2–4
targeted discovery queries as a default, then stop broad discovery when new results stop changing the reader path.
Verify each material claim with the smallest authoritative source that directly supports it. Do not make the
discovery-query count a hard cap for a niche or high-stakes topic.

Discovery is not complete when every named technology has a source. It is complete when the evidence can support the
failure model, the relevant alternatives or composable axes, their boundaries, and the explanation or decision the
reader needs.

Prefer, in order:

1. standards, RFCs, official specifications, and primary research;
2. official project documentation and release notes for implementation behavior;
3. well-regarded technical writing when primary material is inaccessible or insufficient.

For each material claim that may affect the note, record evidence and epistemic status, not prose:

```text
C1 claim
status → supported | nuanced | corrected | conflicting | unverified
S1 source → exact URL or document section
C1 → S1    (the source directly supports this claim)
support → what the source establishes
limits → what the source does not establish
```

Do not use one source as proof for unrelated claims. For version-sensitive, quantitative, surprising, or operational
claims, plan a nearby external Markdown link or footnote; stable textbook-level claims may omit a citation when the
source would add no maintenance value. Do not create a bibliography dump. The final note, not only the temporary
ledger, must retain enough claim-to-source proximity for a future reader to audit important claims.

Do not write or order the note from search results in this phase. A ledger entry is evidence to adjudicate, not a
paragraph ready to paste.

### Phase 3: Adjudicate the teaching model and scope

Phase 2 answers “what can stand up?” This phase answers “what should this note teach, in what order, and why?” Read
`references/reader-model.md` §2–3, consume the claim ledger, but do not write the body yet. Revisit the Phase 0 reader
contract and turn the provisional skeleton into a stable teaching model:

```text
原始主张 → 证据判定 (supported | nuanced | corrected | conflicting | unverified)
修正后 → …
正文处置 → include | qualify | correct | defer | drop
读者作用 / 依赖 → …
来源 / 原因 → …
```

- re-state the central question and one-sentence spine;
- decide each candidate claim or branch: `include`, `qualify`, `correct`, `defer`, or `drop`;
- assign each survivor one role—`premise`, `mechanism`, `example`, `boundary`, or `decision`—and its dependency;
- make every section answer a necessary next question, and make parallel sections state their shared question;
- give each mechanism one primary axis; state secondary axes explicitly instead of presenting composable mechanisms as
  alternatives;
- resolve conflicting sources by their conditions and limits. Do not silently choose a winner;
- create the section blueprint described in `references/reader-model.md`: question, answer, prerequisites, next
  question, relation and why-next edge, admitted claims/examples, boundary, parent, children, and heading level for
  every section. The blueprint is a tree, not a flat list; heading depth must express the teaching model.

Every included claim must earn its place in the spine. A verified fact with no reader question, role, dependency, or
boundary is deferred or dropped. If the evidence changes the reader, after-state, central question, scope, or axes,
return to Phase 0 and rebuild the contract; if a claim is merely missing or conflicting, return to Phase 2. Proceed to
Phase 4 only when the model is stable enough that each section can be described as a necessary question or decision,
each adjacent relation has a reason, and no section is named only for a source or product.

Before leaving this phase, record a compact Teaching Model checkpoint (internally, and in the execution report when
one is being kept): `reader`, `question`, `after`, `scope`, `spine`, `axes`, `heading_convention`, and the complete
section tree. A post-hoc summary of drafted prose is not a checkpoint; without this model, do not enter Phase 4 or
Phase 5.

🔴 CHECKPOINT · TEACHING MODEL GATE

🛑 STOP before Phase 4 if any section lacks a necessary question, answer, dependency, boundary, or `why_next` edge;
return to Phase 0–3 and repair the model before scanning the vault or composing prose.

This adversarial log feeds Phase 8. Corrections and scope decisions are reported in the conversation, not inserted as
commentary into the standalone note. If a conflict materially affects the reader's decision, carry its conditions
into the model as a qualification or boundary; use a `question` callout only when that uncertainty must remain visible.

### Phase 4: Scan the vault

Before composing, inspect the vault for terminology and structure:

1. Resolve one absolute `vault_root`: use an explicit user-provided vault path first; otherwise use the runtime's
   known workspace/vault root; if neither is available, mark `vault_root: unavailable` and do not emit cross-note
   links. Search Markdown files and filenames under that root, while excluding `.git`, `.obsidian`, generated artifacts, and skill
   implementation files unless they are the subject of the note.
2. Read relevant MOC files and enough of related notes to identify their actual defining headings or blocks.
   Record each planned link's exact relative path and anchor in the link ledger; search-result text is not a
   resolved target.
3. Check for an existing note on the same core topic.
4. Decide where the note belongs and which concepts, up to 5, deserve anchored wikilinks.

If the scan changes the reader's prerequisites, terminology, scope, axes, or section relations, return to Phase 3 and
rebuild the affected part of the Teaching Model before composing. Vault conventions and existing links inform the model;
they do not become automatic body sections.

When an existing note covers the same core topic, update it in place by default. Create a new note only for a
genuinely distinct angle, such as a quick reference versus a deep explanation, and explain that choice in the
report. When updating in place, preserve useful metadata and re-verify material claims, but treat the old body order
as candidate material rather than structure truth. Re-admit each kept paragraph through the Teaching Model; a confused
old structure may be fully recomposed in place instead of receiving an appended section.

An explicit user path or filename controls where a requested new angle is written, but it does not authorize a
duplicate same-topic note by itself. Create a duplicate only when the user explicitly asks for a new standalone
note or a distinct angle.

Resolve collisions deterministically:

- one same-topic candidate and no explicit path → update that candidate;
- several same-topic candidates and no explicit choice → route to `clarify` rather than guessing;
- explicit path already exists and is the same topic → update that path;
- explicit path is new but another same-topic note exists → create only when the user explicitly requests a new
  standalone note/angle; otherwise route to `clarify`.

### Phase 5: Compose the note from the reader model

Read `references/reader-model.md` again before drafting. Write from the Phase 3 adjudicated model and section
blueprint, not source-return order or a technology list; research results and reviewer findings are inputs to editorial
judgment, never ready-made prose.

#### 5A. Frontmatter

For a new note, use:

```yaml
---
tags:
  - PascalTag1
  - PascalTag2
  - PascalTag3
summary: "用 1–2 句话说明这篇笔记覆盖什么，以及为什么值得保留。"
---
```

Use 3–5 specific English tags for a new note, using PascalCase where the term permits and preserving official
brand/project casing. Preserve existing frontmatter when updating; change only fields that the task requires. Do
not delete properties such as `aliases`, `title`, dates, or vault-local fields merely
because this template does not use them. Quote the summary safely; use full-width quotation marks inside it.

#### 5B. Body structure

The filename is the title by default; do not add a duplicate `# Title` heading unless the existing convention or user
explicitly requires an explicit body title. In the default implicit-title convention, every major chapter is a `#`
heading. In the explicit-title convention, the matching `# Title` is the root and major chapters are `##`. In either
case, map the Phase 3 section tree to heading levels: a child is exactly one level deeper than its parent, and parallel
chapters are siblings. Do not put one substantive chapter at `#` and then hang unrelated major chapters below it just
because Markdown needs a parent; that makes the outline contradict the teaching model.

Let the argument determine the outline; there is no section-count target. Each top-level section answers a necessary
subquestion; parallel sections state their shared question and relationship. Name sections after the question or
decision they resolve, not merely after a product or noun. Use one running example when several mechanisms are
otherwise abstract.

Before treating the draft as prose, map every top-level section and every material paragraph to the Phase 3 Teaching
Model and its section blueprint. Apply `keep`, `rewrite`, `move`, `merge`, `split`, `delete`, `defer`, or `add` to
anything that has no admitted claim, role, dependency, or transition. Do not preserve a technically correct passage
whose only justification is that it was present in the old note or returned by research.

The note is a reference document, not a conversation response:

- teach the causal model before advice, including why mechanisms exist, how they work, and their boundaries;
- assign each mechanism a primary role, distinguish composable axes from alternatives, and give each paragraph one
  job with explicit non-obvious transitions;
- avoid `Introduction`, `Conclusion`, `总结`, table-of-contents, and dedicated “see also” sections;
- weave wikilinks and source links into the relevant prose;
- keep corrections, review status, and research gaps out of the body.

#### 5C. Callouts and diagrams

Use an Obsidian callout only when removing it would make a misconception, trade-off, uncertainty, or example
harder to find. Zero callouts is correct when the removal test says they add no clarity. Use ordinary prose for
ordinary prose; do not manufacture 2–4 callouts to satisfy a quota.

Use Mermaid only when a diagram compresses a structural or temporal relationship that prose would explain less
clearly. Prefer one primary question per diagram, keep it small, and read `references/mermaid.md` before writing
it. Do not add diagrams or styling for decoration.

### Phase 6: Write and verify the file

Choose the directory and filename from the Phase 4 scan. Respect an explicit user path, title, or filename.
Check for a filename collision before creating a new note. Write with the environment's file-editing tool:

🛑 STOP · WRITE GATE

Before any create or update, confirm the resolved note path, same-topic collision decision, intended write state,
and preservation scope. If any one is unresolved, do not write; route to `clarify` or use the documented recovery
fallback.

- create a new file only after the path is resolved;
- update the existing same-topic file at the same path;
- preserve unrelated content and metadata;
- verify that the file exists and contains the intended frontmatter and body before review.

Treat a write as a transaction with explicit recovery, not as one opaque editor call:

1. For an update, read the original bytes and record an original hash or an equivalent recovery handle.
2. Write the draft to a temporary file in the same directory; do not replace the target yet.
3. Read the temporary file back, run the heading and wikilink gates against that exact file, and confirm the intended
   frontmatter/body boundary.
4. Replace the target atomically when the environment supports it; otherwise use the safest available replacement
   and record that atomicity was unavailable.
5. Read the target back, rerun the required gates against the final path, and only then set `write_status` to
   `written` or `updated`.
6. If validation fails before replacement, discard the temporary file. If replacement may have happened but recovery
   or read-back is uncertain, stop and report `possibly_partial`; never claim `unchanged` or successful delivery.

After read-back, run the deterministic wikilink gate from `references/wikilinks.md` against the actual vault and
the note path. Do not start review or report a passing self-check while that gate is failing. If a target is
ambiguous or missing, remove the link or report the missing vault connection; do not guess.

Run `node scripts/check-heading-tree.ts --strict --file "<note-path>"` as well. This catches skipped heading levels
and the common structural error where a substantive first section becomes the sole parent of otherwise unrelated
chapters. The script cannot decide whether two concepts belong together; that remains a Phase 3 and clarity-review
judgment, not a mechanical formatting rule.

Prefer a temporary file plus atomic replacement when the environment supports it. For an update, retain the
original content until read-back confirms the replacement. Use the write states in
`references/review-lifecycle.md` §7: an uncertain write or recovery is `possibly_partial`, and only a confirmed
read-back may be `written` or `updated`; stop further writes when recovery is uncertain. A non-delivery write
state has no path-based review result.

### Phase 7: Best-effort review without false gates

Review improves confidence but is not a hard dependency on delivery. Spawn two read-only reviewers in parallel
when the environment supports it, using the prompts in `references/review-lifecycle.md` §8 verbatim. Keep their
lifecycles independent.

Resolve the note path, `attempt_id`, and `note_revision` before dispatch. Substitute all three into the prompt
metadata and resolve `<vault-path>/<area>/<filename>.md` to the actual absolute note path; pass the resulting
prompt verbatim and never send an unresolved placeholder to a reviewer. If `write_status` is anything other than
`written` or `updated`, skip path-based reviewers and use the fallback checks against the draft only when the
draft is available.

Before dispatch, read `references/review-lifecycle.md` §4A and reserve the finite budget it defines: the default is
the initial review plus at most two integrated revision rounds. Only an explicit user request may set a larger finite
cap; never extend it implicitly for a new edge case. Track reviewer attempts, fallback passes, and actual body revision
rounds separately; an unavailable reviewer with no body change does not consume a revision round.

Run the relevant self-check once before the first dispatch. This catches malformed Markdown, missing files, and
obvious evidence or link failures before reviewers spend time on a broken draft. Persist the lifecycle checkpoint before dispatch and use bounded waits; at the parent cutoff stop awaiting, not the provider.

#### 7A. Reviewer lifecycle

Read `references/review-lifecycle.md` before dispatch and follow it as the source of truth for state, evidence,
result validation, fallback, retries, and delivery. Keep these invariants visible:

- The parent cutoff stops parent waiting only; it does not prove provider failure or cancel the provider.
- Opaque, empty, or late client observations become `unknown`/`deferred`, never provider failure or cancellation.
- Cancellation requires provider-side stall evidence and termination confirmation; a clean result still requires a
  complete match for the exact attempt and note revision.
- Reserve time for fallback and reporting; never retry while the original attempt is `unknown`, `active`, or
  `cancel-requested`.

#### 7B. Review prompts

Read `references/review-lifecycle.md` §8 and use the matching clarity or accuracy prompt verbatim. Substitute the
resolved absolute note path, `attempt_id`, and `note_revision`; never pass an unresolved placeholder.

#### 7C. Adjudicate, revise, and stop

Use returned findings only; if a reviewer is missing, use the fallback rather than inventing feedback. Apply §4A:
normalize both axes, discard non-actionable duplicates/preferences/out-of-scope items, and make one integrated edit
pass. Treat findings as signals about the artifact, not prose to paste. Before editing, restate the reader contract and
choose the operation that restores the path: keep, rewrite, move, merge, split, delete, defer, or add. Accuracy issues
need source-backed wording; clarity issues may require structural rewrite. New prose must be rewritten in the note's
voice and earn a role in the spine.

After every revision, read the whole note linearly without following links. State the spine in one sentence and the
role of each top-level section. If either cannot be recovered from the note alone, revise the structure before
polishing or adding facts. Rerun only the axes required by §4A when budget remains, and include addressed findings so
reviewers do not re-litigate them.

Classify unresolved findings before stopping. A `reader_blocker` or `accuracy_blocker` means the note is not finished
even if the file was written; only a `polish_item` may remain under a delivered-open-item label.

Run the final self-check in §3 before declaring the review cycle closed and again after every revision. If it
changes note prose, formulas, links, diagrams, or other reviewable content, invalidate and rerun reviewer axes under
§4A when budget remains. Metadata-only fixes do not invalidate content review. A clean review followed by an
unreviewed content change is not a clean final result.

Stop when one of the convergence conditions in §4A is met. Record open issues honestly; do not chase preferences or
edge cases after the finite budget is exhausted.

### Phase 8: Report the result

Read `references/review-lifecycle.md` §7 for write states and delivery labels. Report in Chinese and include only
sections with content:

```text
✅ 笔记已创建/更新: path/to/Title.md（N 轮修订）

Use the success line only for `written/updated`, a passing final self-check, and no `reader_blocker` or
`accuracy_blocker`. For `not_written`, say the note was generated but not written and include the content; for
`possibly_partial`, say the file state is uncertain and do not claim delivery. A written file with a blocker is
`已写入；存在阻塞项，未完成`, not a delivered note.

**回答** — only if the user asked an explicit question: give the direct verdict in 1–3 sentences.

**审查状态** — use the exact delivery matrix in the reference; report facts, not inferred success. In particular,
`deferred` is a parent wait boundary, not `canceled-confirmed`, and an unconfirmed cancel request stays uncertain.

**收敛判断** — state the finite budget, reviewer attempts, fallback passes, actual revision rounds, and the stopping
reason: both clean, no actionable repair, budget exhausted, or fallback/open item. Classify remaining items as
`reader_blocker`, `accuracy_blocker`, `polish_item`, or non-blocking `unverified`; do not describe preference-only or
duplicate findings as unfinished work.

**标签说明**: [brief factual reason]

**修正记录** — when claims were corrected:
- 原始主张: …
- 修正为: …
- 来源: [link]
- 为什么: …

**额外补充** — notable verified additions from research.
**未核实** — researched claims that were not confirmed and were excluded or qualified.
**库内修改** — one line per existing note mutated, including added block IDs or corrected stale content.
**延伸建议** — only when a natural next concept or missing vault note exists.
```

If a reviewer timed out, was deferred, or was canceled-confirmed, describe the actual state. Do not call it a timeout if
the parent merely stopped waiting, and do not call a client cancellation a provider-side termination without
confirmation. If a diagram could not be rendered or parsed in the available environment, include `Mermaid
渲染未验证` (`render-unverified`) in the report rather than implying that it passed.

After the report, if Phase 1 found missing optional skills and state has not been written, ask:

> 检测到 [missing skills] 未安装。选择：**帮我安装**、**不用，记住我的选择**、**下次再说**。

- **帮我安装** — use the environment's skill installer; write state only after every missing skill is available.
- **不用，记住我的选择** — write state to suppress future prompts; if writing state fails, report that choice was
  not persisted.
- **下次再说** — do not write state.

Follow the environment's interactive mechanism. If none is available, report the missing skills and leave state
unwritten; continue with fallbacks.

## §3 Final self-check

Read `references/final-checklist.md` and run it before the first reviewer, after every revision, and once before
the Phase 8 report. Fix failures first; if writing failed, apply content checks to the draft but do not claim a
delivered file.
