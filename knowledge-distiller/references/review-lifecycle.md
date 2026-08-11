# Review protocol

Review is mandatory and read-only. It increases confidence; it never authorizes an unsafe write and never edits the note
itself.

## Two independent axes

Open both reviewers in parallel against the same absolute note path and exact draft hash.

### Clarity

Reconstruct the note's spine, reader after-state, top-level section roles, prerequisites, transitions, terminology,
formatting, diagrams, links, and hidden corrections from the note alone.

Return:

```text
result       → clean | findings | unavailable
teach_back   → one-sentence model the reader can recover
after_state  → what the reader can now explain or decide
findings     → smallest quoted passage plus repair
coverage     → complete | partial
```

`clean` requires complete coverage, a usable teach-back, and no actionable finding.

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

`clean` requires complete coverage, supported claims, correct boundaries, and no unverified material claim. Do not
rediscover the whole topic; use the claim ledger and make only bounded claim-specific lookups when necessary.

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
For clarity, reconstruct teach-back and after-state before listing findings.
For accuracy, check every material claim and mapped surface against its source and limits.
Use the smallest quote for each finding. Use — when absent. Do not mark clean with partial coverage.
```
