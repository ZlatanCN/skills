# Final Self-Check

Run this checklist once before the first reviewer, after every revision, and once before the Phase 8 report. If
the file was not safely written, check the draft but mark path/file checks not applicable and do not claim delivery.

- Scope and route match the user's material; unrelated topics were split or excluded.
- The reader contract has one central question, one-sentence spine, explicit scope boundary, and a useful after-state;
  every top-level section answers a necessary subquestion, with dependencies or parallel relationships made explicit;
  each adjacent section relation has a reason the reader can understand.
- A linear read without following links recovers the spine and the role of each section; no paragraph or comparison is
  an orphan, a false alternative, or a mechanically appended research/reviewer return; every material paragraph maps to
  a section role in the Teaching Model.
- The heading tree matches the Teaching Model: the title convention is explicit, heading levels encode parent/child
  relations, parallel chapters are siblings, no level is skipped, and no substantive chapter is the sole parent of
  unrelated major sections. `check-heading-tree.ts --strict` passes.
- Each comparison uses one coherent axis; a cross-axis mechanism has an explicit primary and secondary role.
- Language, terminology, formulas, code, and conversation-boundary rules are satisfied.
- Material claims have direct evidence; unverified claims are removed or qualified, with important current or
  quantitative claims retaining nearby sources.
- The note teaches cause, mechanism, trade-offs, and boundary conditions without a duplicate title, forced
  Introduction/Conclusion, table of contents, or bibliography dump.
- New-note frontmatter and update-preservation rules are satisfied.
- Existing same-topic choice and output path are correct; `write_status` and read-back prove the claimed file state,
  while uncertain recovery is reported as `possibly_partial`.
- The semantic link ledger is sound, the deterministic wikilink gate passes, and every link has an exact unique target
  position; new block IDs are unique and reported.
- `references/obsidian-writing-style.md` was read; the `format_plan` has a decision for every retained callout,
  diagram, table and emphasis target, core conclusions are findable, callouts and diagrams pass its removal test,
  and original explanatory examples were not removed without a reader-model reason. Mermaid follows
  `references/mermaid.md`, and unavailable rendering is reported as `Mermaid 渲染未验证` with a prose fallback.
- Sentence-level cleanup (and `humanizer-zh` when available) was used only to repair concrete reading obstacles; it
  is not treated as evidence that the reader model is coherent.
- Reviewer states, provider evidence, fallback checks, actionable-finding ledger, finite convergence budget, late
  results, blocker classification, and cancellation claims are truthful; no wall-clock duration was treated as provider
  failure. A `reader_blocker` or `accuracy_blocker` prevents delivery even when the file was written.
- The Phase 8 report accurately states revisions, corrections, unresolved claims, vault mutations, and delivery state.
