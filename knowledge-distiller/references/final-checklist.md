# Final Self-Check

Run this checklist once before the first reviewer, after every body revision, and before the Phase 8 report. If the
file was not safely written, inspect the exact draft but do not claim delivery.

## 1. Let the scripts decide mechanical facts

For a written note, retain the JSON from the canonical `check-note.ts` command in
`references/mechanical-gates.md` §2.

The checker owns frontmatter/fence/table/callout/Mermaid surface syntax, heading structure, the hash-bound teaching
model, anchored wikilink resolution, external-link placement metadata and format-plan coverage. Its `passed` state does not establish truth, semantic link value, reader path or
render success. See `references/mechanical-gates.md` for the evidence contract and limits.

For review and delivery, retain the JSON from `check-review-journal.ts` and `check-delivery-report.ts`. A self-test is
not an actual-note pass, and a checker marked `unavailable` must remain unavailable in the report.

## 2. Keep the semantic gates human-readable

- Scope, route, central question, spine, after-state and section dependencies still match the reader contract.
- `check-teaching-model.ts` passes against the exact final bytes; every visible heading has a transition and the
  `diagram_policy` agrees with the explicit `MERMAID_REQUEST_FLAG` and the actual Mermaid surface; the terminal
  section closes both next fields with `null`.
- Linear reading recovers the teaching model; no paragraph, comparison, link or research return is orphaned or a false
  alternative.
- Claims have direct evidence and explicit limits; unverified central claims are qualified, deferred or removed.
- The note teaches cause, mechanism, trade-offs and boundaries without a duplicate title, forced Introduction/Conclusion,
  table of contents or bibliography dump.
- `references/obsidian-writing-style.md` and, when relevant, `references/mermaid.md` were read. Callouts, emphasis,
  tables, code, diagrams, links and footnotes have a reader function; external links are attached to prose, footnotes
  or callouts with claim/support/placement records; removal tests support retained blocks; Mermaid
  rendering unavailable is reported as `Mermaid 渲染未验证` with nearby prose fallback.
- Preservation scope, existing-note mutations, frontmatter, read-back, write status and recovery state are truthful.
- Clarity/accuracy findings are identity-bound to the exact revision and hash; fallback is labeled `manual_checked`,
  late results stay `late_ignored`, and reader/accuracy blockers prevent a success label.
- The Phase 8 report states revisions, corrections, unresolved claims, vault mutations, open items and the final label
  without upgrading a mechanical pass into a semantic or reviewer pass.
