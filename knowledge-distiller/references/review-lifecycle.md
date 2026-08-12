# Review protocol

Review is mandatory and read-only. It increases confidence; it never authorizes an unsafe write and never edits the note
itself.

## Two independent axes

Open both reviewers in parallel against the same absolute note path and exact draft hash.

### Clarity

Reconstruct the note's spine, reader after-state, filename-title convention, heading tree, top-level section roles, prerequisites,
transitions, terminology, formatting, diagrams, links, and hidden corrections from the note alone. For each heading, identify
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

`clean` requires complete coverage, a usable teach-back, a recoverable heading tree, and no actionable finding. Mechanical
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

Adjudicate both axes together. Make one integrated edit pass, then repeat the safe write, final read-back, and both
reviews against the new hash. Allow at most two material revision rounds. A punctuation-only change still requires a new
final hash but does not require a new research model.

If a provider is unavailable or returns contradictory metadata, perform the same exact-draft manual check and report
`manual_checked` or `unavailable`; never call it provider-clean. A client timeout or empty poll is not evidence of clean
or failed review, but the user-facing task must not hang forever waiting for an opaque provider.

## Compact review record

```text
review → {
  clarity: {result, findings},
  accuracy: {result, findings},
  note_path,
  draft_hash,
  revision
}
```

No JSONL event stream, attempt state machine, observability field, late-result protocol, or fallback budget is required.

## Reviewer prompts

Pass the resolved path, exact hash, reader contract, claim ledger, and the following instructions:

```text
Read the exact note bytes. Do not rewrite them. Return the required fields only.
For clarity, reconstruct teach-back, after-state, heading convention, and heading tree before listing findings. For every
heading, state its parent question and sibling relation; distinguish true parallel H1 chapters from flattened child
questions. Flag sibling inflation, false parents, heading flood, or unjustified depth. Do not demand extra hierarchy when the
questions are genuinely independent. For each novel, user-proposed, contested, or central abstraction, identify its concrete
origin, design motivation, and epistemic status.
For accuracy, check every material claim and mapped surface against its source and limits. Treat proposed classifications as
hypotheses until their status, axis, scope, overlap, and coverage are adjudicated.
Use the smallest quote for each finding. Use — when absent. Do not mark clean with partial coverage.
```
