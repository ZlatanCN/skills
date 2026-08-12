# Review protocol

> **Review is a gate, not a decoration.**
>
> Review is **mandatory and read-only**. It increases confidence; it never authorizes an unsafe write and never edits the
> note itself. A partial, stale, or unavailable review is not clean.

Review is mandatory and read-only. It increases confidence; it never authorizes an unsafe write and never edits the note
itself. Read this reference before dispatching either reviewer.

## Two independent axes and per-axis rounds

> **Two axes, two ceilings.**
>
> `clarity` and `accuracy` are independent gates. Each has a maximum of **two rounds**. Findings from one axis never cancel the
> other; stop early only when both are clean.

When both axes are needed, open clarity and accuracy in parallel against the same absolute note path and exact draft hash.
Each axis uses its own question and evidence: clarity uses the reader contract and note; accuracy uses the claim ledger and
sources. They may cite the same passage, but neither result substitutes for the other. Each axis has at most two rounds; stop
early when both are clean.

### Clarity

Reconstruct the note's core judgment, concrete problem, mechanism, observable example, single reader teach-back and resulting
choice, filename-title convention, heading tree, top-level section roles, prerequisites, transitions, terminology, formatting,
diagrams, links, and hidden corrections from the note alone. For each heading, identify
the parent question it serves and whether its siblings are genuinely parallel, composable, alternative, causal, or refining.
Flag `sibling_inflation` when contained subquestions are flattened; `false_parent` when a substantive section is used as the
parent of unrelated chapters; `heading_flood` when local examples or boundaries are promoted without navigation value; and
`depth_overrun` when deep nesting has no clear reader function. Do not require more levels when the note's questions are truly
parallel. For external links, verify that each link is an affordance on an existing semantic unit in the claim-bearing
sentence, footnote, or callout. Flag a standalone source tail, source list, or generic anchor that introduces a new citation
object. Do not flag a sentence-final link when it is grammatically part of the sentence, or an identifiable source-title/
citation used as a syntactic participant. For each new abstraction, check that the reader can recover its concrete origin,
the design problem it solves, and its status as a standard, working model, or disputed claim. Do not require this sequence for
every definition; require a motivation when the abstraction is novel, user-proposed, contested, or central to the note.

Return:

```text
result       → clean | findings | unavailable
teach_back   → one-sentence model the reader can recover
after_state  → what the reader can now explain or decide
findings     → smallest quoted passage plus repair
coverage     → complete | partial
```

`clean` requires complete coverage, a concise teach-back that names the core judgment, concrete problem, mechanism, observable
example, and resulting choice, a recoverable heading tree, and no actionable finding. A catalogue of covered topics is not a
teach-back. Mechanical
heading validity alone is not sufficient.

### Accuracy

Check every material claim, including claims in frontmatter, headings, lists, tables, callouts, code comments, Mermaid
labels, links, and examples, against its listed source and scope.

Return:

```text
result        → clean | findings | unavailable
claims_checked → count or partial
source_coverage → complete | partial
unverified    → claims without sufficient evidence
findings      → claim, issue, scope, and source
```

`clean` requires complete coverage, supported claims, correct boundaries, and no unverified material claim. For a
classification, verify its source status, comparison axis, abstraction level, scope, overlap, and claimed coverage; do not
treat a user's proposed categories as formal facts without evidence. Do not rediscover the whole topic; use the claim ledger
and make only bounded claim-specific lookups when necessary.

## Revision

> **Rebuild, do not patch.**
>
> Adjudicate both axes together. Findings identify an affected teaching unit and a repair direction. They are **not** sentence
> replacement text. Rebuild the smallest complete unit, then review the new exact bytes.

Adjudicate both axes together. Round one reviews the draft/final bytes. Findings diagnose affected teaching units; they are
not line-edit instructions. Reconcile clarity and accuracy findings for each affected unit, reread its premise/problem,
mechanism, example, boundary, transition, and choice, and rebuild the smallest complete unit that restores both claim correctness
and reader continuity. Make one integrated edit pass and run round two for both axes against the new exact bytes. Do not stack
patches on the stale draft, start a second revision, or start a third round for any axis. If both axes are clean in round one,
stop; two rounds each is a ceiling, not a quota.

A provider failure, timeout, empty result, or contradictory metadata is not silently retried. Record that axis as
`unavailable` or `manual_checked`; only the planned second wave may run, and it must review the new exact hash. The parent
workflow may reconcile findings from both axes and choose one bounded revision, but it must not invent a third review axis or
re-review the note outside the stated round limits. A punctuation-only change still requires a new final hash but does not
require a new research model. A naturalness pass that changes wording also produces a new review target: reread the new exact
bytes and check that qualifiers, causal relations, terminology, and teaching-unit boundaries remain unchanged.

## Compact review record

```text
review → {
  clarity: {round, result, coverage, findings},
  accuracy: {round, result, coverage, findings},
  note_path,
  draft_hash,
  revision
}
```

No persistent event stream or run bundle is required. Keep the two per-axis round counters in memory and include them in the
review record; do not use missing persistence as permission to exceed either two-round limit.

## Reviewer prompts

Pass the resolved path, exact hash, reader contract, claim ledger, and the following instructions:

```text
Read the exact note bytes. Do not rewrite them or dispatch another reviewer. Return the required fields only, including this
axis's round number and coverage.
For clarity, reconstruct the core judgment, concrete problem, mechanism, observable example, resulting choice, and teaching
units before listing findings. Check directness and natural technical Chinese after structure is stable: flag filler, praise,
promotional language, vague authority, empty summaries, literal translations, unsupported transitions, or wording that sounds
like a performance of explanation. Findings should identify the smallest affected unit, not prescribe a sentence-level patch. Check paragraph permission and adjacency: for each topic shift, identify the preceding question or
mechanism, the paragraph's one job, and the later explanation or decision it enables. Flag locally correct orphan material that
requires hidden conversation context, introduces an unused concept, or lacks a recoverable reason to appear there; recommend
only delete, move, or add the smallest in-scope bridge. Also flag a paragraph that combines multiple independent teaching jobs,
or a semicolon/connective phrase that hides a change of subject, mechanism, or reader task; do not enforce a raw paragraph-length
or semicolon-count threshold. For every H1, state its independent top-level question; for every H2/H3, state its immediate parent
question and sibling relation. Do not infer heading depth from the causal spine: flag a parent only when it fails to contain the
child question, and flag flattened H1 siblings only when they share a genuine parent. Reject a note that is locally correct but
requires the reader to retain a catalogue of controls, terms, or sources rather than one causal model. If the mechanism is
never made observable in a minimal example or scenario, flag the smallest missing example unless the topic genuinely cannot be
demonstrated. Check format fit as well as format misuse: if a key flow, actor sequence, lifecycle, entity relation, or timeline
must be reconstructed across paragraphs, consider whether the matching Mermaid type would materially clarify it; if a core
judgment, boundary, warning, stop rule, example, or reusable model is easy to lose during scanning, consider the matching
callout. Do not require either format when prose is equally clear, and flag only missing formats with a clear reader benefit. Treat
reminder phrases such as “注意”, “第一原则”, “关键认知”, and “需要明确” as prompts to inspect callout fit, not as automatic
conversion rules; also inspect unmarked core boundaries and stop rules. Distinguish true parallel H1 chapters from flattened
child questions. Flag sibling inflation, false parents, heading flood, or
unjustified depth. Check
every external link for natural claim placement; a source tail or source list is a finding. Check each correction, limitation,
or causal conclusion inherited from the user's reasoning: its local antecedent must be recoverable from the note, otherwise
flag the smallest missing premise or conversational rebuttal shell. For each necessary enumeration, check that its items share
a classification axis and predicate, and that reading it returns the reader to the current decision; if not, flag mixed axes,
role mixing, redundant coverage, or list-induced loss of the paragraph's subject and causal relation. Do not demand extra
hierarchy when questions are genuinely independent. For each novel, user-proposed, contested, or central abstraction, identify
its concrete origin, design motivation, and epistemic status.
For accuracy, check every material claim and mapped surface against its source and limits. Treat proposed classifications as
hypotheses until their status, axis, scope, overlap, and coverage are adjudicated.
Use the smallest quote for each finding and name the affected teaching unit plus the repair direction; do not provide a final
replacement passage. Use — when absent. Do not mark clean with partial coverage or a stale hash.
```
