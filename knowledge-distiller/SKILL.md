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

Optimize in this order:

1. **Truth** — specific claims are supported by current, authoritative evidence or are removed/qualified.
2. **Teachability** — explain why the mechanism exists, then how it works and where it breaks.
3. **Vault integrity** — reuse existing definitions and link to real positions, not merely matching words.
4. **Renderability** — produce valid, readable Obsidian Markdown.
5. **Efficiency** — stop research and review when additional work is no longer changing the result.

The note is the durable artifact; the Phase 8 report is the conversational audit trail. Never put the audit
trail, the user's mistakes, or the fact that the note was generated into the note body.

An explicit user request for language, title, path, metadata, structure, or output format overrides these style
defaults. It does not override factual integrity, preservation of unrelated vault content, security, or basic
accessibility.

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

## §2 Workflow

### Phase 0: Analyze the input and choose a route

Parse the user's material into:

- the core topic and a useful note title;
- subtopics that belong together and topics that must become separate notes;
- claims needing verification, especially versions, dates, numbers, behavior, performance, and causal claims;
- missing prerequisites, misconceptions, and oversimplifications;
- whether architecture, protocol flow, data flow, interaction order, or state transitions would become clearer
  as a diagram.

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

### Phase 1: Check extension skills

Run this phase only after Phase 0 selects `distill_note`; `answer_only` and `clarify` must stop before this
phase so they cause no setup side effects.

Locate `**/knowledge-distiller/scripts/setup-state.sh` with the environment's file-search tool. If it does not
exist, skip this phase and do not ask about extension state. If it exists, run:

```bash
bash "<script-path>"
```

- Exit `0`: `state.json` exists; skip the missing-skill check.
- Exit `1`: check `humanizer-zh` and `obsidian-markdown` through the environment's skill mechanism and record
  which are available.
- Any other exit or execution error: treat setup state as unavailable, continue with fallbacks, do not write
  state, and report the setup check as incomplete if it affects the user-facing result.
- If all are available, write state immediately with `bash "<script-path>" write`; if that write fails, record
  `state_write_failed`, continue without state, and report the incomplete setup.
- If any are missing, defer the user's install/remember choice to Phase 8. Do not write state until that choice
  is made.

### Phase 2: Research and build an evidence ledger

Research is mandatory when creating or materially updating a technical note. It is not required for the plain
question path in Phase 0.

Use the environment's search and URL-reading tools. Start with 2–4 targeted discovery queries as a default,
then stop broad discovery when new results stop changing the outline. Claim verification is separate: verify
each claim that survives into the note with the smallest authoritative source that directly supports it. Do not
make the discovery-query count a hard cap for a niche or high-stakes topic.

Prefer, in order:

1. standards, RFCs, official specifications, and primary research;
2. official project documentation and release notes for implementation behavior;
3. well-regarded technical writing when primary material is inaccessible or insufficient.

For each material claim, record:

```text
C1 claim → keep / qualify / correct / drop
S1 source → exact URL or document section
C1 → S1    (the source directly supports this claim)
reason → what the source establishes and what it does not establish
```

Do not use one source as proof for unrelated claims. If a claim cannot be verified with reasonable effort,
remove it, state only its verified core, or put it in Phase 8 `未核实`; never assert it as fact in the note.
For version-sensitive, quantitative, surprising, or operational claims, place a nearby external Markdown link
or footnote in the note. Stable textbook-level claims may omit a citation when the source would add no maintenance
value. Do not create a bibliography dump. The final note, not only the temporary ledger, must retain enough
claim-to-source proximity for a future reader to audit important claims.

### Phase 3: Record corrections and scope decisions

Maintain an adversarial log while researching. Separate user claims from facts added by research:

```text
- 原始主张: …
- 判定: confirmed / nuanced / corrected / unverified
- 修正后: …
- 来源: …
- 原因: …
```

This log feeds Phase 8. Corrections are reported in the conversation, not inserted as commentary into the
standalone note. If a research result conflicts with another result, preserve the disagreement, explain the
conditions behind each result, and use a `question` callout only when the disagreement materially affects the
reader's decision.

### Phase 4: Scan the vault

Before composing, inspect the vault for terminology and structure:

1. Search Markdown files and filenames, while excluding `.git`, `.obsidian`, generated artifacts, and skill
   implementation files unless they are the subject of the note.
2. Read relevant MOC files and enough of related notes to identify their actual defining headings or blocks.
   Record each planned link's exact relative path and anchor in the link ledger; search-result text is not a
   resolved target.
3. Check for an existing note on the same core topic.
4. Decide where the note belongs and which concepts, up to 5, deserve anchored wikilinks.

When an existing note covers the same core topic, update it in place by default. Create a new note only for a
genuinely distinct angle, such as a quick reference versus a deep explanation, and explain that choice in the
report. When updating in place, preserve useful existing metadata and structure, re-verify the claims being
kept, and report substantive corrections to the existing file.

An explicit user path or filename controls where a requested new angle is written, but it does not authorize a
duplicate same-topic note by itself. Create a duplicate only when the user explicitly asks for a new standalone
note or a distinct angle.

Resolve collisions deterministically:

- one same-topic candidate and no explicit path → update that candidate;
- several same-topic candidates and no explicit choice → route to `clarify` rather than guessing;
- explicit path already exists and is the same topic → update that path;
- explicit path is new but another same-topic note exists → create only when the user explicitly requests a new
  standalone note/angle; otherwise route to `clarify`.

### Phase 5: Compose the note

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

The filename is the title; do not add a duplicate `# Title` heading unless the existing note's convention or the
user requires it. Let the topic determine the outline. Usually use 2–4 top-level `#` sections with nested `##`
and `###` sections, but a smaller topic may need fewer. Do not force a hierarchy that adds no teaching value.

The note is a reference document, not a conversation response:

- teach the causal model before listing advice;
- explain why a mechanism exists, how it works, and its boundary conditions;
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

- create a new file only after the path is resolved;
- update the existing same-topic file at the same path;
- preserve unrelated content and metadata;
- verify that the file exists and contains the intended frontmatter and body before review.

After read-back, run the deterministic wikilink gate from `references/wikilinks.md` against the actual vault and
the note path. Do not start review or report a passing self-check while that gate is failing. If a target is
ambiguous or missing, remove the link or report the missing vault connection; do not guess.

Prefer a temporary file plus atomic replacement when the environment supports it. For an update, retain the
original content until a follow-up read confirms the replacement. If the write command errors before a usable
new file exists, set `write_status=not_written`. If a new file exists but its intended content cannot be
confirmed by read-back, set `write_status=possibly_partial`. If an existing file may have been changed but
recovery or read-back is uncertain, first restore the original content when it is available and verify it. If
restoration is confirmed, set `write_status=unchanged`; otherwise set `write_status=possibly_partial`, stop
further writes, and report that state. Only set `write_status=written` or `updated` after read-back confirms the
intended content. A non-delivery write state has no path-based review result.

### Phase 7: Best-effort review without false gates

Review improves confidence but is not a hard dependency on delivery. Spawn two read-only reviewers in parallel
when the environment supports it, using the prompts below verbatim. Keep their lifecycles independent.

Resolve the note path, `attempt_id`, and `note_revision` before dispatch. Substitute all three into the prompt
metadata and resolve `<vault-path>/<area>/<filename>.md` to the actual absolute note path; pass the resulting
prompt verbatim and never send an unresolved placeholder to a reviewer. If `write_status` is anything other than
`written` or `updated`, skip path-based reviewers and use the fallback checks against the draft only when the
draft is available.

Before dispatch, reserve a finite review budget. Use at most two revision rounds by default; allow one additional
round only for a new high-severity issue and only while the parent task still has budget for fallback and
reporting. If the user explicitly requests exhaustive iteration, choose a larger finite cap before dispatch and
report it; never create an unbounded reviewer loop. Count revision rounds even when a reviewer is unavailable.

Run the relevant self-check once before the first dispatch. This catches malformed Markdown, missing files, and
obvious evidence or link failures before reviewers spend time on a broken draft. Persist the lifecycle checkpoint before dispatch and use bounded waits; at the parent cutoff stop awaiting, not the provider.

#### 7A. Reviewer lifecycle

Read `references/review-lifecycle.md` before dispatch. It is the source of truth for attempt IDs, execution
states, late results, retry safety, complete reviewer-result validation, manual fallback, and the final delivery
matrix. In particular:

- `unknown` means an opaque provider may still be working; it is not a failure;
- `deferred` means the parent stopped awaiting; it is not cancellation;
- `cancel-requested` does not mean the provider terminated the work;
- `canceled-confirmed` is still not a quality pass;
- read §3A for the evidence boundary: a client timeout or empty poll is not provider liveness, failure, or cancellation confirmation;
- `No issues` is valid only when every required checklist item is returned for the exact note revision and
  attempt ID;
- a missing or protocol-invalid axis must be `manual_checked` against the Phase 2 evidence, using the same
  formula, term, mechanism-rationale, reader-blockage, claim, and source checks as the reviewer prompt.

Reserve enough of the remaining task budget for fallback checks, writing, and the report. The parent cutoff
protects delivery; it is not a kill deadline for a reviewer that is still making progress. Use a no-progress
threshold only when the mechanism exposes a meaningful liveness signal. With an opaque provider, stop awaiting
at the cutoff and defer. Cancel only after the reference's confirmed-stall conditions, and never retry while the
original attempt is still unknown or cancellation is unconfirmed.

#### 7B. Review prompts

**Clarity reviewer:**

```text
axis: clarity
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <vault-path>/<area>/<filename>.md

You are a junior engineer learning this topic. Treat your own prior knowledge of this topic as near-zero and judge whether the note alone lets you follow along. Report only concrete findings and quote the exact passage for each:
- C1: every symbol in a formula/equation that is never defined;
- C2: every material technical term used before it is defined, anchored to a defining vault position, or used as a common English fixture;
- C3: any sentence containing 3 or more unexplained material technical terms;
- C4: any mechanism or behavior stated without explaining why it is designed that way;
- C5: the single section where a reader is most likely to get stuck and the missing prerequisite.
Return all five labels, using “—” for an item with no finding, followed by `result: clean` or `result: findings`. Preserve the metadata above exactly. Do not give vague praise. Say `result: clean` only when every item has no finding.
```

**Accuracy reviewer:**

```text
axis: accuracy
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <vault-path>/<area>/<filename>.md

You are an expert in this field. Check every factual claim. For A1, quote the exact claim for each problem, state the correction or missing nuance, and cite a source you can actually stand behind. If a claim cannot be verified with confidence, mark it “unverified” instead of guessing. Return `A1: —` only when every claim is accurate and properly scoped; otherwise return each finding under A1, followed by `result: clean`, `result: findings`, or `result: unverified`. Preserve the metadata above exactly.
```

#### 7C. Adjudicate, revise, and stop

Use returned findings only. If a reviewer is missing, use the fallback rather than inventing feedback. Correct
accuracy issues with source-backed wording; repair clarity issues by adding the missing causal step or example.
After a revision, rerun the affected review axes when budget remains and include a short list of already-addressed
issues so reviewers do not re-litigate fixed findings.

Run the final self-check in §4 before declaring the review cycle closed and again after every revision. If it
changes note prose, formulas, links, diagrams, or other reviewable content, invalidate the affected reviewer
state and rerun that axis when budget remains. Metadata-only fixes do not invalidate content review. A clean
review followed by an unreviewed content change is not a clean final result.

Stop when both reviewers are clean, when remaining budget is exhausted after fallback checks, or when a repeated
round produces no new actionable information. Record open issues honestly. Do not chase perfection by making
unbounded review rounds.

### Phase 8: Report the result

Report in Chinese and include only sections with content:

```text
✅ 笔记已创建/更新: path/to/Title.md（N 轮修订）

Use the success line only for `write_status=written` or `updated` **and a passing final self-check**. For
`not_written`, use instead:

📝 笔记内容已生成但未写入: [reason]. 内容已在下方给出，可复制到新笔记。

For `possibly_partial`, use instead:

⚠️ 文件状态不确定，未宣称交付: [path/reason]. 先确认文件内容，再决定是否恢复或重写。

**回答** — only if the user asked an explicit question: give the direct verdict in 1–3 sentences.

**审查状态** — report facts, not inferred success:
- `written/updated` + both valid reviewer results clean + self-check pass + no open items → `双轴审查通过`.
- `written/updated` + missing axes manually checked + self-check pass + no open items → `已交付；部分审查由人工复核`.
- `written/updated` + unresolved or unverified items → `已交付；存在未决项`.
- `written/updated` + self-check failed → `文件已写入；自检未通过，未宣称交付`.
- `unchanged` → `更新未写入；原文件已保留`，或说明草稿已完成人工复核；不得称为交付。
- `not_written` → `内容未写入；未执行路径审查`，或说明草稿已完成人工复核；不得称为交付。
- `possibly_partial` → `文件状态不确定；未宣称交付`.
- Parent cutoff is `deferred`, not `canceled-confirmed`; a cancel request without confirmation is `取消请求未确认`.

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

## §3 Edge cases

| Situation | Response |
| --- | --- |
| Plain question with no shared understanding | Answer directly; create no note and skip mandatory note research. |
| Very little technical material | Build a focused note from research; report additions, not a conversation trace in the note. |
| Broad but coherent topic | Choose a sensible boundary and state it in the report; do not block on clarification. |
| Unrelated topics | Split into separate notes or ask which topic to prioritize if splitting would destroy coherence. |
| Existing same-topic note | Update in place by default; create a new angle only with a report justification. |
| Research unavailable or weak | Keep only the verified core; mark omitted claims under `未核实`. |
| Review provider slow or unavailable | Protect the parent workflow with a wait budget, defer rather than falsely pass, run fallback checks, and report the actual state. |
| File write blocked | Show the complete note content and say it is ready to copy; do not claim creation. |
| Input contains code | Preserve code exactly where possible, use syntax fences, and verify the code separately when feasible. |
| Mixed Chinese and English | Chinese prose; preserve conventional English terms, code, identifiers, URLs, and quoted material. |
| User requests another note language | Follow that explicit request and keep the rest of the workflow. |
| User gives a title, path, or filename | Honor it for a new note or explicitly requested new angle; the same-topic update rule still wins otherwise. Preserve existing metadata when updating. |

## §4 Final self-check

Run this once before the first reviewer and after every revision, then run it one final time before the Phase 8
report. Fix any failure first. If a write failed, run content checks against the draft, mark path/file checks as
not applicable, and do not claim that a file was delivered.

### Artifact checks

- [ ] Scope matches the user's material; unrelated topics were split or excluded.
- [ ] Prose is in the requested language; code, formulas, names, and conventional technical terms are preserved appropriately.
- [ ] No conversation framing appears in the note body.
- [ ] Material claims are supported by the evidence ledger; unverified claims are removed or qualified.
- [ ] Important current, quantitative, surprising, or operational claims retain nearby source links or footnotes;
  stable claims may omit citations only when that is deliberate. Each retained source directly supports the nearby
  claim rather than merely discussing the same topic.
- [ ] The note teaches cause, mechanism, trade-offs, and boundary conditions rather than listing slogans.
- [ ] New-note frontmatter has 3–5 specific tags and a quoted Chinese summary; updates preserved unrelated properties.
- [ ] No duplicate title, forced introduction/conclusion, table of contents, or reference dump was added.
- [ ] Existing same-topic decision and output path are correct; for `written/updated`, read-back confirms the
  file; for `unchanged/not_written/possibly_partial`, delivery is not claimed and the state is reported.

### Vault and Markdown checks

- [ ] Central wikilinks point to real notes and exact defining headings/blocks; each target position was read and
  actually defines the concept rather than merely mentioning it; no guessed anchors or invented links. The
  deterministic wikilink gate exits 0, and no target is ambiguous.
- [ ] Any new block ID is unique, placed correctly, and reported under `库内修改`.
- [ ] Callouts and diagrams pass the removal test and add clarity rather than decoration. If the diagram candidate
  from Phase 1 fails that test, omission is correct; if it passes, the diagram is present.
- [ ] Any Mermaid block follows `references/mermaid.md` and renders or passes a syntax-oriented preflight check.
- [ ] If Mermaid rendering was unavailable, the report says `Mermaid 渲染未验证` (`render-unverified`) and the
  note retains a textual explanation of the diagram's relationship.
- [ ] Humanizer patterns were checked through `humanizer-zh` or its manual fallback.
- [ ] Long parentheticals and nested paired em dashes were removed when they suspend the sentence.

### Review and delivery checks

- [ ] Each reviewer has an honest final state; `deferred`, `failed`, `cancel-requested`, and `canceled-confirmed` are not reported as passes.
- [ ] No reviewer was canceled solely because its wall-clock duration was long.
- [ ] Every missing review axis received the correct fallback self-check.
- [ ] The review round cap and shared parent budget were respected; no unbounded rerun occurred.
- [ ] Revision count, corrections, unresolved claims, vault mutations, and review status are accurately reported.
