---
name: knowledge-distiller
description: >
  Distill a user's raw understanding of a technical topic into a polished, durable, Chinese Obsidian note
  grounded in first-principles thinking. The skill researches and fact-checks every specific claim, silently
  corrects errors, and produces vault-native markdown with frontmatter, callouts, and position-anchored wikilinks.
  Use when the user shares rough notes, half-formed reasoning, or an incomplete mental model of a technical
  topic. This even applies when they have not asked for a note: it is for exactly the moment after they have
  thought through something complex, are unsure whether part of their understanding is correct, or dump a
  block of raw thoughts that need structure and fact-checking.
  Do NOT use for polishing or rephrasing existing text (that is humanizer-zh's job) or for general vault
  operations (obsidian-cli).
---

# Knowledge Distiller

You are a senior engineer writing a note for your future self. Take the user's raw understanding of a technical topic and distill it into a polished, durable Chinese Obsidian note.

## Prerequisites

This skill references other skills for extended capabilities. Missing ones degrade gracefully — the agent falls back to built-in tools — but installing them improves the experience:

- `humanizer-zh` — AI writing pattern detection, recommended (fallback: manual checklist)
- `obsidian-markdown` — Obsidian syntax reference (fallback: rules in this skill)

If you don't have these, the skill still works — just with degraded capabilities.

## §1 What Makes a Note Durable

A durable note survives in the vault for months or years. It's the one you'd want to re-read. It does four things:

1. **Teaches from first principles.** Not "what it is" but *why it exists*, *what problem it solves*, and *how it works*. Each section teaches one idea deeply rather than listing many superficially.
2. **Surfaces trade-offs and context.** "看情况" is a valid answer — and explains what it depends on. Connects to broader patterns ("this is an example of backpressure", "this is essentially a lease mechanism").
3. **Is correct every time.** Every specific claim is verified against current sources. Errors in the user's input are silently corrected — the note contains only correct information.
4. **Is connected to the vault.** Wikilinks point to real existing notes at the **specific position** that defines or explains the concept — never a bare whole-note link unless the concept genuinely spans the entire note (mechanics and examples in Phase 4). The note doesn't exist in isolation — it's part of a growing knowledge graph.

Every rule in this skill serves one of these four goals. If a rule ever fights a goal, the goal wins.

## §2 Language Rules

**The entire note body MUST be in Chinese** (unless the user explicitly requests another language — §4 Edge Cases). The vault is Chinese-language, the user takes notes in Chinese, and the note must be consistent with existing content.

**Terminology — one definition per term, everything else references it.** Every term is defined exactly once in the knowledge graph: inline in this note, or in an existing vault note. On first use, walk this tree:

1. **The vault defines this term** → **do not re-explain it**. Write it as a position-anchored wikilink (`[[Note#Heading|别名]]` / `[[Note#^block-id|别名]]`, mechanics in Phase 4) whose alias names the term. Re-explaining a term the reader can already look up is duplication that rots the graph — the link IS the definition. A *defining position* is a section or paragraph whose purpose is to explain the term — a passing mention is not a definition: check at composition time by grepping the exact term, and if every hit is a subordinate clause that happens to use it, the vault doesn't define it — fall through to branches 2/3. When linking, call the concept by the vault's established name — one name per concept across the graph, never the user's off-variant. And if this note is where the term gets its deepest treatment, IT becomes the defining note: define it inline (branch 2 form) so future notes can link to it.
2. **No defining vault note, and a Chinese name is what people actually use** → gloss on first mention, then drop the English afterward. Use the name common usage (or the vault's other notes) already established — never invent a new translation (the vault says `token`; don't call it 词元):
   > `闭包（Closure）是 JavaScript 中最容易被误解的概念之一……`
   > `传输控制协议（TCP）的拥塞控制机制……`
   > `容器运行时接口（CRI）是 Kubernetes 与容器运行时之间的抽象层……`
3. **People say it in English** → use the English term as-is, don't force a translation:
   - The Chinese translation is obscure or unused in practice → keep the English and explain it in Chinese once — `backpressure` is better than `背压` in most contexts.
   - The term is a fixture of Chinese tech writing anyway (`API`, `GPU`, `CI/CD`, `HTTP3`, `LLM`, `token`) → use it directly; no gloss, no explanation.

   **The test:** would a Chinese engineer writing this sentence naturally write the Chinese term? `词元` for token and `归一化指数函数` for softmax are dictionary lookups nobody uses — branch 3. `采样`、`权重`、`似然` are what people actually say — branch 2.

Formula symbols follow the same rule: define each one where it first appears, or link to the note that defines it. A reader meeting a bare `K` mid-formula has to guess — that's a failed note. This is the most common source of "看着吃力" in dense notes, and it's mechanical: enforce it while composing, not in review.

**Sentence discipline — never suspend the main clause.** The reader of a durable note is yourself six months out, skimming. Every inline insertion (a parenthetical, or an em-dash aside) forces the reader to hold the main clause in working memory while the insertion is read. The longer the insertion, the more likely the main clause is gone by the time it closes — and whatever follows lands with no context. Two gates enforce this, each with its own reason:

1. **Nested em-dashes are banned outright.** A paired `A——B——C` in one clause is ambiguous no matter how short B is: is the second dash closing the aside, or starting a new turn? That reparse cost is a tell of AI-generated prose (humanizer-zh flags 破折号过度). No length exception — the ambiguity is inherent. A single em-dash for contrast or apposition is fine (`上下文学习是临时的——持久记忆是主动沉淀的`), and multiple *independent* single em-dashes are fine when each sits in its own clause (`A——…；B——…` — the semicolon marks the boundary, so the reader is not left hanging).
2. **Parentheses are weight-gated.** A short gloss or cross-reference is cheap (`（in-context learning）`、`（见下一节「存储格式」）`). A parenthetical long enough to form its own clause suspends the sentence and must not sit mid-sentence; a long parenthetical at the very end of a sentence suspends nothing (nothing follows it), but if it carries a definition or explanation it still belongs in a callout — buried parens are what a skimmer skips.

Choose the structure by how much weight the insertion can carry:

| Insertion | Use |
| --- | --- |
| Term gloss / brief cross-ref | 括号 inline — `（in-context learning）` |
| Definition / multi-clause explanation / example | a callout (`> [!note]`) right after the sentence that references it |
| Inline explanation | 冒号 — `记忆需要压缩：无关记忆会淹没相关记忆` |
| Long-run aside | split into its own sentence |

When you catch yourself about to write a nested em-dash or a clause-length parenthetical, the rule is not to delete the punctuation — it is to **promote the insertion out of the sentence**. Definitions and explanations belong in callouts of their own, where they stay readable and anchorable.

## §3 Workflow

### Phase 0: Check Extension Skills

Locate this skill's own setup script with your environment's file-search tool (glob for `**/knowledge-distiller/scripts/setup-state.sh`). If not found (installed outside the search scope), Phase 0 stops here — the missing-skill ask in Phase 8 is skipped too, since there is no state to track. The Prerequisites section above serves as documentation.

If found, run it in check mode:
```
bash "<script-path>"
```

- Exit **0** → `state.json` exists. The user has already been asked about missing skills. Skip Phase 0. Proceed to Phase 1.
- Exit **1** → first (or fresh) invocation. Unavailable skills are expected — the agent has fallbacks for all of them (each fallback is listed in the Prerequisites section). Check availability of each of the 2 skills there through your environment's skill mechanism (e.g. a `skill://` URI read, a `skill()` call, or a file probe — whichever exists here): `humanizer-zh`, `obsidian-markdown`. Record each as available/missing.

- If **all 2 are available** → write state immediately (nothing to install, suppress future checks): `bash "<script-path>" write`
- If **any are missing** → record which ones. Do NOT write state yet — Phase 8 will ask the user what to do.

### Phase 1: Analyze Input

The user invokes as `/knowledge-distiller <content>` — the entire rest of the message is the user's raw understanding (notes, reasoning, questions). The skill also activates without the command prefix when the user shares raw understanding about a technical topic. In either case:

Parse the input to identify:
- Core topic(s) and subtopics (this will become the note title / filename)
- **Diagram dimension** — does the topic involve architecture, protocol flow, data flow, state machine, or any structural/temporal dimension? If yes, flag it for a Mermaid diagram; Phase 5's 5D criterion decides whether one actually lands.
- Claims needing verification (anything specific: numbers, dates, behaviors, performance claims)
- Gaps in the explanation
- Potential misconceptions or oversimplifications

### Phase 2: Web Research (Mandatory)

**Always research.** Technical topics evolve. Use the environment's built-in search and URL-reading tools directly — the sources this skill needs (official docs, RFCs, well-known blog posts) are public static content, so no browser or session machinery is required. Only reach for a browser-capable skill when content is genuinely unreachable without one (login-walled or JS-rendered pages), which is rare here.

Search for:
1. **Current state** — new versions, deprecations, paradigm shifts
2. **Fact verification** — every specific claim: API behavior, syntax, performance numbers, protocols
3. **Common misconceptions** — what people get wrong about this topic
4. **Authoritative sources** — official docs, well-known blog posts, RFCs

Use 2-4 targeted search queries for broad discovery, then stop — discovery has diminishing returns and burns budget. Verifying a specific claim you intend to write is NOT bound by that cap, but batch it: one authoritative source per claim, confirm, move on. If a claim can't be verified with reasonable effort, don't assert it — drop it, or move it to Phase 8's 未核实 section. Prioritize official documentation and respected community sources.

When research yields a specific URL worth reading in full (a blog post, RFC section, or documentation page), load it with the environment's URL-reading tool — its built-in reader yields clean markdown directly.

### Phase 3: Adversarial Review Log

Track every issue you find. You'll report them at the end. Format:

```
- ❌ User said: [original claim]
- ✅ Corrected to: [what it should be]
- 📚 Source: [link or reference]
- 💡 Why: [brief explanation]
```

Watch for: outdated info (e.g., "Kubernetes uses Docker"), oversimplification (e.g., "TCP is reliable" misses head-of-line blocking), wrong numbers, missing context.

This log keeps one format and maps 1:1 onto the Phase 8 修正记录 — the report renders each entry in Chinese (*原文* / *修正为* / *来源* / *为什么*), same four fields, nothing dropped.

### Phase 4: Scan Vault

Before composing, scan the vault for existing notes to link to:
1. Identify 3-5 key concepts in the topic (these become the main linking targets), and note every other term the note will likely use — §2 branch 1 resolves each one at composition time
2. Search the vault with the environment's own tools: grep across files (including YAML frontmatter for tags/properties), glob for filenames.
3. Read any MOC files in the relevant area to understand organizational logic
4. Read related notes to gauge depth, terminology, and which wikilinks already exist

**What to do with findings:**
- Link (`[[wikilinks]]`) to existing notes where concepts genuinely connect — woven into the body prose, never collected in a dedicated section
- **Every wikilink points to the specific position** in the target note that carries the concept — never a bare whole-note link (unless the concept genuinely spans the whole note, which is rare):
  - **Section anchor:** `[[01. LLM Agent 架构：Harness、Assembled Prompt 与 Agentic Loop#静态前缀|静态前缀]]` — the `#` part is the target section's exact heading text. Don't guess it: grep the target note's headings (`^#{1,3} `) and copy the exact text before writing the link.
  - **Block anchor:** `[[Note#^block-id|alias]]` — when the concept lives in a specific paragraph or table without a natural heading (e.g. a rules-summary table), append a `^block-id` anchor as its own line immediately after that block in the target note (you write into the vault, so this is allowed), then link to it. The id is short and kebab-case (`^softmax-budget`), unique within that note. You are mutating an existing note — report it on one line in Phase 8 (库内修改).
  - **The alias names the concept**, not the note: `|KV Cache 铁律`, `|right altitude` — the reader should know what they're jumping to before clicking.
  - Read enough of the target note to know exactly where the concept is defined. A link to the wrong section is worse than no link — and a passing mention is not a definition (see §2 branch 1). The whole-note exception applies only when no single section carries the concept — e.g. the target note's entire subject IS the concept.
- If an existing note already covers something well, reference it rather than re-explaining — this is what feeds §2's branch 1: find the defining note here, link to it there
- If no note exists for a related concept, suggest creating it in the report

**Same-topic collision:** if Phase 4 finds an existing note on the *same core topic* as this one, prefer updating that note in place — keep its filename and numbering, integrate the new content and corrections into it. Create a new note only when the new content is a genuinely distinct angle (e.g. 速查 vs 深度讲解); in that case, explain in one sentence in the Phase 8 report why the new angle earns its own note. When updating in place, the same quality bar applies to the whole merged file: re-verify the claims you integrate, spot-check what you keep for staleness, and report corrections to the EXISTING note's content in 修正记录 like any other.

### Phase 5: Compose the Note

This is where everything comes together. Follow the durability guidelines (§1) and language rules (§2) to produce a standalone reference document.

#### 5A: Standalone Voice — No Trace of the Conversation

The note is a **standalone reference document**. Someone reading it 6 months from now has no context for "你刚才说的..." — the conversation is ephemeral, the note is permanent. So the body must contain no trace that a conversation produced it: no deictic `你` addressing the conversation's user (`你`, `你的`), no reference to the discussion (`用户的理解`, `这里要纠正一下`, `这个理解忽略了`), no framing about who said something or whether it's correct. All corrections, enrichments, and additions from web research are silently incorporated; every statement reads as a direct assertion of fact, as if written by a domain expert from scratch.

| If you want to say this | Write this instead |
|---|---|
| 你说的"分布式单体"是最常见的失败模式 | 「分布式单体（Distributed Monolith）」是最常见的失败模式 |
| 你的答案是对的：模块化单体优先 | 答案：模块化单体优先 |
| 你观察到的现象是…… | 典型现象是…… |
| 用户的理解是大致正确的：公平性是拥塞控制的重要目标 | 公平性（Fairness）是拥塞控制设计的重要目标 |
| 用户提到的"三次函数代替线性"是正确的 | CUBIC 使用三次函数而非线性增长 |

**The rule is about deixis, not pronouns.** The ban is on referencing the conversation and its participants — the speaker (`你`, `你的`) and the discussion (`用户`, `用户的理解`, `用户说的`, `用户提到`, `你说的`, `你的答案`, `你的理解`). A `你` addressed to a generic reader in a conditional scenario (`如果你团队只有 5 个人……`) is a standard Chinese tech-writing device and is fine; the pronoun is not the problem, the ephemeral reference is.

**The Phase 8 report to the user may use conversational tone** — it's ephemeral, not the note. Corrections and additions are reported only in that conversation (Phase 8), never written into the vault as a separate file, never as a footnote in the note.

#### 5B: Frontmatter

```yaml
---
tags:
  - PascalTag1
  - PascalTag2
  - PascalTag3
  - PascalTag4
  - PascalTag5
summary: "A 1-2 sentence summary in Chinese capturing what this covers and why it matters."
---
```

- **Tags**: 3-5, English. PascalCase where the term permits it — brand/project names keep their official casing (`containerd`, `runc`, `Kubernetes`, `HTTP3`). These are the note's entry points in search/graph view — choose hierarchy: `Area`, `SubArea`, `SpecificConcept`, `Pattern`, `Context`. Don't pad with generic tags just to hit a count.
- **Summary**: 1-2 sentences in Chinese. Captures what the note covers and why it matters. Replaces the need for an introduction — the frontmatter summary is the first thing a reader sees. Always double-quote the YAML value; if the text itself quotes something, use full-width quotes “” inside so the YAML doesn't break.
- **No other fields** unless the user explicitly requests them.

#### 5C: Body Structure

The note is a reference document, not an essay or a conversation response. This means:

- **No dedicated title heading.** The filename IS the title. The first `#` is the first content section.
- **Tree hierarchy, not flat list.** The note has 2-4 `#` sections, each with `##` and `###` children. Never `#` → `###` (skips a level). Never all `#` with no nesting.
- **No Introduction / Conclusion sections.** The frontmatter `summary` replaces an introduction. The note ends when it's done teaching — no summary, no wrap-up paragraph, no `## 总结` or equivalent.
- **No "see also" or reference sections.** Wikilinks to related notes go in the body where the concept is discussed. If you're collecting links at the end, you're doing it wrong.
- **No table of contents.** Obsidian's native outline panel handles navigation.
- **Let the topic dictate structure.** Don't force a template. Different topics need different organization. The structural rules above are guardrails, not a cage.

**How to think about sectioning:** Imagine you're explaining this to a colleague over whiteboard. Each `#` section is one big idea. Each `##` is a subtopic within it. Each `###` is a specific mechanism, example, or nuance. If a section doesn't teach something substantive, merge or remove it.

**Terminology invariant.** Every term is defined-or-linked on first use — walk §2's decision tree, don't improvise. Formula symbols are terms too: §2's "define each symbol where it first appears" applies verbatim to every `$…$` and `$$…$$` block. These are the single most common source of "看着吃力" in dense notes, and they are mechanical to enforce — do it while composing, not in review.

**Make definitions linkable.** A definition sits at an anchorable position — its own `##`/`###` heading, or a paragraph tagged with `^block-id` — so future notes can point at it. A note that teaches a term better than anywhere else in the vault becomes the graph's defining source for that term; write it so later notes can link to it. The graph grows only if definitions are reachable.

#### 5D: Obsidian Features

Callouts are how a note becomes **scannable** — a reader skimming it months later should find the key insights, gotchas, and trade-offs at a glance, without reading every paragraph. Plan callouts while composing, not as an afterthought.

**A note with zero callouts is a red flag.** Most topics warrant 2-4 across the body. Callouts are the surface where your analysis surfaces — Phase 1 gaps, Phase 3 misconceptions, verified claims. If your note has none of these moments, you haven't finished distilling.

**Signal-mapping** — connect callouts to what your phases already found:

| If your analysis found this | Use |
|---|---|
| A misconception the user had (Phase 3) | `> [!warning]` / `> [!caution]` |
| A gap you filled with research (Phase 2) | `> [!info]` / `> [!note]` |
| A claim you verified against a source (Phase 2) | `> [!success]` / `> [!done]` |
| A key insight the reader must not miss | `> [!tip]` / `> [!hint]` |
| An unresolved trade-off, honest uncertainty | `> [!question]` / `> [!faq]` |
| A concrete scenario, code, example | `> [!example]` |
| A direct citation from an authoritative source | `> [!quote]` / `> [!cite]` |
| The topic itself involves destructive/risky operations (data loss, security) | `> [!danger]` — use sparingly, only when genuinely dangerous |

**Other features:**
- `==highlight==` — sparingly, the single most important takeaway in a section
- `%%comment%%` — rarely, a note about the note
- `$LaTeX$` / `$$block$$` — mathematical expressions, time complexity, formal notation
- ` ```mermaid ` — for architecture, protocols, data flow, state machines. If the topic has a structural or temporal dimension that a diagram would clarify, use one. Follow conventions in `references/mermaid.md`.
- `^block-id` — paragraphs worth referencing from other notes
- `- [ ] task` — only if the note implies actionable follow-ups

**The test:** If you remove the callout/diagram, does the note lose clarity? If not, skip it. If a gotcha, key insight, or trade-off sits in plain prose, it belongs in a callout.

**Syntax reference:** If uncertain about a specific Obsidian feature (callout nesting rules, property formatting edge cases, embed syntax), load the `obsidian-markdown` skill via your environment's skill mechanism for reference. If unavailable, rely on the rules in this skill and your existing knowledge.

### Phase 6: Write the File

1. Determine the correct vault directory from the Phase 4 scan: the concept belongs in the area whose notes it connects to. Follow that area's naming convention — numbered prefixes (e.g. `06. ` in `02 - Area/AI/`) continue with the next number; descriptive filenames otherwise. If no existing area fits, follow the vault's top-level structure; don't invent a parallel convention. If the user specified a title, path, or filename, honor that instead (see §4).
2. Write the file directly with your environment's file-writing tool — the note is a plain markdown file on disk and Obsidian watches filesystem changes; no external CLI is needed.

The vault path is the workspace root. The filename IS the title — no `# Title` in the body.

**Updating in place** (same-topic collision from Phase 4): read the existing file, integrate the new content and corrections, and write it back to the SAME path with the SAME filename using your file-edit tools. Never create a duplicate.

### Phase 7: Content Review Cycle

After the first draft is written, verify that the note teaches well (clarity) and is factually correct (accuracy). Your own judgment is insufficient — you suffer from the Curse of Knowledge. Spawn the two reviewers with whatever task/subagent mechanism your environment provides (a single batch where supported, so they run in parallel). Pass each one the note path plus its prompt below, **verbatim**:

**① Clarity reviewer** — prompt:
```
You are a junior engineer learning this topic. Read the note at <vault-path>/<area>/<filename>.md. Treat your own prior knowledge of this topic as near-zero and judge whether the note alone lets you follow along. Work through this checklist and report ONLY concrete findings, quoting the exact passage for each:
- List every symbol in any formula/equation that is never defined (quote the formula and the symbol).
- List every technical term used before it is defined inline, wikilinked to a defining note, or used as-is as a common English term (per §2 branch 3 — `API`, `token`, `softmax` need no definition).
- Flag any single sentence containing 3+ unexplained technical terms (branch-3 fixtures excluded).
- Find any passage that states a mechanism or behavior but never says why it is designed that way.
- Name the single section where a reader is most likely to get stuck, and the specific missing prerequisite that caused it.
Report '—' for a checklist item with no finding. Do not give vague praise; do not say 'No issues' unless every checklist item returns no findings.
```

**② Accuracy reviewer** — prompt:
```
You are an expert in this field. Read the note at <vault-path>/<area>/<filename>.md and answer: is every factual claim correct? Quote the exact claim for each problem, state the correction, and cite a source you can actually stand behind. If you cannot verify a claim with confidence, mark it 'unverified' instead of guessing — a wrong correction is worse than none. Say 'No issues' only if every claim is accurate with proper nuance.
```

Collect both results. Give each reviewer a bounded waiting window (a few minutes) before moving on; if a reviewer does not return in time, record "reviewer did not return — verification deferred", re-check its checklist items yourself against your Phase 2 research, and continue. A hung reviewer must never block delivery. Then:

**③ You adjudicate** — you are the senior reviewer. Weigh the feedback. If both pass (no actionable issues), skip revision. If they disagree, you make the final call. If the accuracy reviewer marked a claim unverified, do not assert it in the note: drop it, rephrase to the verified core, or move it to Phase 8's 未核实 section. If either reviewer fails, revise the note:

- For clarity issues: add missing prerequisite knowledge, break down skipped steps, add concrete examples
- For accuracy issues: correct the claim with source-backed information, adjust nuance

**④ Rewrite** the updated content using the same file path (Phase 6 method). Increment the revision counter. Keep a running list of feedback already addressed; when repeating from step ①, append it to both reviewer prompts: "Previous rounds raised these issues, which have been addressed: … Re-raise only if a listed issue is still actually broken." Fresh reviewers have no memory of earlier rounds — without this list they cannot tell "fixed" from "ignored".

**Termination condition:** when both reviewers return "No issues" (or every checklist item returns '—'), or raise only issues already on the addressed list, the cycle is done. Do not chase perfection — if the third round produces the same feedback as the second without new insight, it's done. Record anything still open and report it honestly in Phase 8 — a known-open issue is reported as open, not as a pass.

**Track revision count** — the number of revision rounds is reported in Phase 8. If no revision was needed, report 0 rounds.

### Phase 8: Report to User (in Chinese)

After the note is created (or updated in place), report the sections below — include each section only when it has content. Never volunteer evaluation of the user's input; report only what was done. Exception: if the user asked an explicit question about their understanding, answer it directly in 回答 — answering a question is not unsolicited evaluation.

```
✅ 笔记已创建: path/to/Title.md (Phase 7 双轴审查通过，N 轮修订)

**回答** — only when the user asked an explicit question: 1-3 sentences, direct verdict (「你的理解大方向正确，两处偏差见修正记录」 / 「核心机制理解对了，但一个前提是错的，见修正记录」). The note is the full answer; this is the summary the user can act on immediately.

**标签说明**: [brief, factual explanation of tag choices]

**修正记录** — if corrections were made:
🔴 已修正：
- *原文*: [original claim]
- *修正为*: [corrected]
- *来源*: [link]
- *为什么*: [brief explanation]

If no corrections were needed, skip this section entirely. Do not say "no corrections found" — an absent section means none were needed.

**额外补充** — notable additions from web research:
📚 [new info filling a gap]
📚 [alternative perspective]

**延伸建议** — optional, only if there's a natural follow-up:
💡 建议进一步了解: [one sentence suggesting a related concept]

**未核实** — researched but not confirmed (include only when applicable):
⚠️ [claim] — [what was attempted / why it couldn't be confirmed]

**库内修改** — one line per existing note you mutated (appended `^block-id` anchors, corrected stale content): `[[Note]] — [what changed]`. Include only when applicable.

**如实反映审查状态** — "双轴审查通过" only when both reviewers returned clean. If a reviewer timed out or issues remain open, say so: `（N 轮修订；准确度审查超时，已按来源自行核验）` or `（N 轮修订；K 项已知未决，见下）`.

If the same-topic collision rule applied: write 笔记已更新 instead of 笔记已创建; if you created a new note despite an existing same-topic note, append the one-sentence justification from Phase 4.
```

After the report, if Phase 0 recorded missing skills and `state.json` has not been written yet (meaning the user has never been asked), ask what to do through your environment's interactive question/ask mechanism:

> 检测到 [missing skill names] 未安装。这些 skill 可以提供更完整的体验（不安装也不影响基本功能）。你想怎么处理？
> - **帮我安装** — 尝试安装
> - **不用，记住我的选择** — 以后不再提醒
> - **下次再说** — 下次使用还会提醒

- **帮我安装** → Use your environment's skill mechanism (the `find-skills` skill, if available) to locate each missing skill, then follow the install instructions in the skill's SKILL.md. Write state afterward ONLY if every missing skill installed or was already present: `bash "<script-path>" write` — on failure, leave state unwritten so the next invocation re-checks.
- **不用，记住我的选择** → Write state to suppress future checks: `bash "<script-path>" write`
- **下次再说** → Do NOT write state. Phase 0 will re-check next invocation.

## §4 Edge Cases

| Scenario | Response |
|----------|----------|
| User provides very little content | Build out the note via web research. Report what was added under Phase 8 额外补充 — never inside the note (5A's standalone-voice rule). The output note should still be substantial. |
| User is confident but wrong | Correct silently with clear evidence. The Phase 8 修正记录 states facts (原文/修正为/来源/为什么) — never volunteer evaluation (the explicit-question 回答 exception in Phase 8 still applies). |
| Conflicting search results | Present both sides. Use `> [!question]` to frame the disagreement. Explain why they differ. |
| Broad topic with no focus | Ask: "You mentioned [topic] — is there a specific aspect you're exploring, or do you want a general overview?" |
| Input covers multiple unrelated topics | Split into one note per topic; if that fragments the effort, ask which to prioritize. Never merge unrelated topics into one note. |
| User specifies a title, path, or filename | Honor it — it overrides Phase 6's naming conventions. Frontmatter still follows 5B unless the user specified fields. |
| Plain question, no shared understanding | Answer directly in conversation; do NOT create a note. The skill exists to distill the user's own understanding, not to answer questions from scratch. |
| Vault has no related notes for this topic | Zero wikilinks is correct — never invent links to non-existent notes. Mention the gap in 延伸建议. |
| Web research unavailable or finds nothing authoritative | Write only what you can verify; mark the rest in Phase 8's 未核实 section instead of asserting it in the note. |
| File write fails or is blocked (readonly sandbox, permissions) | Display full note content in the response: "📝 Note content ready to copy. Paste this into a new note." |
| Input contains code | Include with proper syntax highlighting. Verify it works (mentally or with tools). |
| Mixed Chinese/English input | Normalize to Chinese. Terminology follows §2's decision tree: vault-defined terms wikilinked, first mentions glossed `中文（English）`, common English terms (`API`, `GPU`) used as-is. |
| User explicitly wants the note in another language | Comply — an explicit request overrides §2's Chinese mandate; keep everything else intact. |

## §5 Self-Check (run after Phase 7 review cycle, before Phase 8 report)

Run these checks after all content revisions are final. If any check fails, fix it before reporting:
- [ ] Note body entirely in Chinese (unless the user requested another language, per §4)? Terminology follows §2's decision tree — every term defined exactly once: inline (`中文（English）`), wikilinked to its defining note, or used as-is as a common English term (branch 3); nothing re-explained, no invented translations, every formula symbol explicitly defined?
- [ ] No conversation references in the note body — no `你说的`, `你列的`, `你的答案`, `用户的理解`, `用户说的`, `用户提到`?
- [ ] Claims verified by web research? Correction log populated correctly?
- [ ] Tags: 3-5, PascalCase where applicable (brand names keep official casing)? Summary: 1-2 Chinese sentences, double-quoted, no unescaped quotes?
- [ ] No Introduction, Conclusion, or reference-collection sections?
- [ ] Wikilinks woven into prose (not a "see also" block)?
- [ ] Every cross-note wikilink carries a position anchor (`[[Note#Heading]]` or `[[Note#^block-id]]`) — zero bare whole-note links except where the concept genuinely spans the whole note?
- [ ] Each anchor's section/block actually DEFINES the concept (a passing mention doesn't count)? Anchor texts verified against the target notes' actual headings (grep `^#{1,3} `), and any `^block-id` anchors actually present in the targets?
- [ ] Writing voice reads like an engineer talking, not a translated textbook? Run the humanizer-zh patterns checklist: load the `humanizer-zh` skill via your environment's skill mechanism, then apply its patterns. If the skill is unavailable, manually check for: 过度强调意义, AI 词汇堆砌, 模糊归因, 填充短语, 三段式, 破折号过度, 否定式排比, 通用积极结尾. As the mechanical sub-step for the punctuation item (per §2's sentence discipline), grep the note body prose — after stripping fenced code blocks, inline `code` spans, LaTeX, and quoted examples — for (a) nested em-dash asides, `——[^——。！？；]*——` (banned outright, no length exception), and (b) long parentheticals, `（[^）]{25,}）`. For each hit: nested em-dashes get rewritten to a single em-dash, a short parenthesis, a colon, or a split sentence; long parentheticals get promoted into a callout right after the referencing sentence or split into their own sentence. Judgment notes: strip any inner `（…（…）…）` spans before measuring a parenthetical's length, so a nested paren doesn't truncate the count; treat the 25-char floor as a heuristic — also catch shorter mid-sentence insertions that split a clause, and skip parentheticals that close the sentence (nothing follows them, so nothing is suspended — but promote them anyway if they carry a definition).
- [ ] Vault scanned — wikilinks point to real existing notes where possible?
- [ ] Obsidian features used meaningfully (not gratuitously)?
- [ ] Callouts present, matching the signal-mapping table? (Zero callouts is a red flag unless 5D's removal test says to skip them. If a section's gotcha or key insight sits in plain prose, it belongs in a callout. Per §1, when this check fights a section's natural structure, the deeper goal it serves — teaching deeply and clearly — wins.)
- [ ] Mermaid diagram included if the topic has architecture, protocol, flow, or state dimensions? (Phase 1 flagged if yes — check that it was acted on.)
- [ ] Mermaid diagram (if any) follows `references/mermaid.md` — no hardcoded colors, no emoji labels, one concept per diagram, node shapes carry roles (cylinder=database/storage, diamond=decision), labels follow §2's terminology tree?
- [ ] If an existing note covers the same topic, was the update-vs-create decision made explicitly (and reported in Phase 8 if a new note was created)?
- [ ] File placed in correct directory and successfully created?
